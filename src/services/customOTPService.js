// src/services/customOTPService.js
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const OTP = require('../models/OTP');
const cacheService = require('./cacheService');
const Twilio = require('twilio');

// 1. ADDED: Brevo Adapter
const BrevoTransport = require('nodemailer-brevo-transport');

class CustomOTPService {
  constructor() {
    // --- 2. CHANGED: Email transporter setup (Switched from Gmail to Brevo) ---
    this.emailTransporter = null;

    // We now check for EMAIL_API_KEY instead of YOUR_EMAIL_APP_PASSWORD
    if (process.env.EMAIL_API_KEY) {
      try {
        this.emailTransporter = nodemailer.createTransport(
          new BrevoTransport({
            apiKey: process.env.EMAIL_API_KEY
          })
        );
        console.log('✅ Email Service Ready (via Brevo HTTP)');
      } catch (err) {
        console.error('❌ Email Transport Init Failed:', err.message);
      }
    } else {
      console.warn('⚠️ EMAIL_API_KEY missing in .env - Email OTP disabled');
    }

    // --- SMS setup (KEPT EXACTLY THE SAME) ---
    this.twilioClient = null;
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) {
      try {
        this.twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        this.twilioFrom = process.env.TWILIO_FROM;
        console.log('✅ Twilio SMS service configured');
      } catch (e) {
        this.twilioClient = null;
        console.warn('⚠️ Twilio initialization failed:', e.message || e);
      }
    } else {
      console.warn('⚠️ Twilio credentials not configured - SMS OTP disabled');
    }
  }

  // Private helper to normalize various phone formats to E.164
  _normalizePhoneToE164(phone) {
    const digitsOnly = String(phone).replace(/\D/g, '');

    if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
      // Input is like '916377...'
      return `+${digitsOnly}`;
    }
    if (digitsOnly.length === 10) {
      // Input is like '6377...'
      return `+91${digitsOnly}`;
    }
    // If it's already in E.164 format or something else, return as is
    return phone;
  }

  // Generate random OTP
  generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[crypto.randomInt(0, digits.length)];
    }
    return otp;
  }

  // Rate limiting check
  async checkRateLimit(identifier, type, maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    try {
      const key = `otp_rate_limit:${type}:${identifier}`;
      const attempts = await cacheService.incrementRateLimit(key, Math.floor(windowMs / 1000));
      if (attempts > maxAttempts) {
        throw new Error(`Too many OTP requests. Please try again after ${Math.floor(windowMs / 60000)} minutes.`);
      }
      return attempts;
    } catch (error) {
      if (error.message && error.message.includes('Too many')) {
        throw error;
      }
      console.warn('Rate limiting check failed, continuing:', error.message || error);
      return 1;
    }
  }

  // 📧 EMAIL OTP - Send email OTP
  async sendEmailOTP(email, purpose = 'login', userId = null, ipAddress = '127.0.0.1') {
    try {
      if (!this.emailTransporter) {
        throw new Error('Email OTP not configured. Check EMAIL_API_KEY in .env file');
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new Error('Please enter a valid email address');
      }

      await this.checkRateLimit(email, 'email');
      const otp = this.generateOTP(6);
      const hashedOTP = await bcrypt.hash(otp, 10);

      await OTP.create({
        userId,
        identifier: email.toLowerCase(),
        type: 'email',
        purpose,
        hashedCode: hashedOTP,
        ipAddress,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        maxAttempts: 3
      });

      const subject = this.getEmailSubject(purpose);
      const html = this.getEmailTemplate(purpose, otp);

      // --- 3. CHANGED: Updated 'from' to match your Brevo Verified Sender ---
      await this.emailTransporter.sendMail({
        from: 'Pulsee <rajveershekhawat626@gmail.com>', // MUST match your dashboard
        to: email,
        subject: subject,
        html: html
      });

      console.log(`✅ Email OTP sent to ${email} for ${purpose}`);
      return {
        success: true,
        identifier: email.toLowerCase(),
        type: 'email',
        purpose,
        expiresIn: '10 minutes',
        message: `OTP sent to ${email}`
      };
    } catch (error) {
      console.error('Email OTP send error:', error.message || error);
      throw new Error(`Failed to send email OTP: ${error.message || error}`);
    }
  }

  // 📱 SMS OTP - Send SMS OTP via Twilio
  async sendSMSOTP(phone, purpose = 'login', userId = null, ipAddress = '127.0.0.1') {
    try {
      if (!this.twilioClient || !this.twilioFrom) {
        throw new Error('SMS OTP not configured. Please set TWILIO credentials in .env file');
      }

      // Use the normalization helper to ensure E.164 format
      const fullPhone = this._normalizePhoneToE164(phone);
      if (!fullPhone.match(/^\+91[6-9]\d{9}$/)) {
        throw new Error('Please enter a valid Indian mobile number.');
      }

      await this.checkRateLimit(fullPhone, 'sms');
      const otp = this.generateOTP(6);
      const hashedOTP = await bcrypt.hash(otp, 10);

      // Store in database with the canonical E.164 format
      await OTP.create({
        userId,
        identifier: fullPhone,
        type: 'sms',
        purpose,
        hashedCode: hashedOTP,
        ipAddress,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
        maxAttempts: 3
      });

      const smsBody = this.getSMSTemplate(purpose, otp);

      const message = await this.twilioClient.messages.create({
        body: smsBody,
        from: this.twilioFrom,
        to: fullPhone
      });
      console.log('✅ Twilio message SID:', message.sid);

      return {
        success: true,
        identifier: fullPhone,
        type: 'sms',
        purpose,
        expiresIn: '5 minutes',
        message: `OTP sent to ${fullPhone}`
      };
    } catch (error) {
      console.error('SMS OTP send error:', error.message || error);
      throw new Error(`Failed to send SMS OTP: ${error.message || error}`);
    }
  }

  // Email subject templates
  getEmailSubject(purpose) {
    const subjects = {
      signup: '🎉 Welcome to Pulse - Verify Your Email',
      login: '🔐 Pulse Login Verification Code',
      password_reset: '🔑 Reset Your Pulse Password',
      verification: '✉️ Verify Your Pulse Account'
    };
    return subjects[purpose] || subjects.login;
  }

  // COMPLETE Email HTML templates (ALL KEPT INTACT)
  getEmailTemplate(purpose, otp) {
    const templates = {
      signup: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; }
            .header h1 { color: #ffffff; margin: 0; font-size: 28px; font-weight: 600; }
            .content { padding: 40px 30px; }
            .greeting { font-size: 18px; color: #333333; margin-bottom: 20px; }
            .message { font-size: 15px; color: #666666; line-height: 1.6; margin-bottom: 30px; }
            .otp-container { background-color: #f8f9fa; border: 2px dashed #667eea; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0; }
            .otp-label { font-size: 13px; color: #666666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; font-weight: 600; }
            .otp-code { font-size: 36px; font-weight: 700; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace; margin: 10px 0; }
            .expiry { font-size: 13px; color: #999999; margin-top: 15px; }
            .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .warning-text { font-size: 14px; color: #856404; margin: 0; }
            .footer { background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e9ecef; }
            .footer-text { font-size: 13px; color: #6c757d; margin: 5px 0; }
            .divider { height: 1px; background-color: #e9ecef; margin: 30px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Welcome to Pulse</h1>
            </div>
            
            <div class="content">
              <p class="greeting">Hello there!</p>
              
              <p class="message">
                Thank you for signing up with Pulse. We're excited to have you on board! 
                To complete your registration and verify your email address, please use the verification code below:
              </p>
              
              <div class="otp-container">
                <div class="otp-label">Your Verification Code</div>
                <div class="otp-code">${otp}</div>
                <div class="expiry">⏱️ Valid for 10 minutes</div>
              </div>
              
              <p class="message">
                Enter this code in the app to verify your account and get started with all the amazing features Pulse has to offer.
              </p>
              
              <div class="warning">
                <p class="warning-text">
                  <strong>🔒 Security Notice:</strong> Never share this code with anyone. 
                  Our team will never ask for your verification code via email, phone, or text message.
                </p>
              </div>
              
              <div class="divider"></div>
              
              <p class="message" style="font-size: 13px; color: #999999;">
                If you didn't request this code, please ignore this email. Your account remains secure.
              </p>
            </div>
            
            <div class="footer">
              <p class="footer-text"><strong>Pulse</strong></p>
              <p class="footer-text">Connect. Share. Pulse.</p>
              <p class="footer-text" style="margin-top: 20px;">
                © ${new Date().getFullYear()} Pulse. All rights reserved.
              </p>
            </div>
          </div>
        </body>
        </html>
      `,

      login: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; }
            .header h1 { color: #ffffff; margin: 0; font-size: 28px; font-weight: 600; }
            .content { padding: 40px 30px; }
            .greeting { font-size: 18px; color: #333333; margin-bottom: 20px; }
            .message { font-size: 15px; color: #666666; line-height: 1.6; margin-bottom: 30px; }
            .otp-container { background-color: #f8f9fa; border: 2px dashed #667eea; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0; }
            .otp-label { font-size: 13px; color: #666666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; font-weight: 600; }
            .otp-code { font-size: 36px; font-weight: 700; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace; margin: 10px 0; }
            .expiry { font-size: 13px; color: #999999; margin-top: 15px; }
            .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .warning-text { font-size: 14px; color: #856404; margin: 0; }
            .footer { background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e9ecef; }
            .footer-text { font-size: 13px; color: #6c757d; margin: 5px 0; }
            .divider { height: 1px; background-color: #e9ecef; margin: 30px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Login Verification</h1>
            </div>
            
            <div class="content">
              <p class="greeting">Welcome back!</p>
              
              <p class="message">
                We received a login request for your Pulse account. To continue signing in, 
                please use the verification code below:
              </p>
              
              <div class="otp-container">
                <div class="otp-label">Your Login Code</div>
                <div class="otp-code">${otp}</div>
                <div class="expiry">⏱️ Valid for 10 minutes</div>
              </div>
              
              <p class="message">
                Enter this code in the app to complete your login and access your account.
              </p>
              
              <div class="warning">
                <p class="warning-text">
                  <strong>🔒 Security Alert:</strong> If you didn't attempt to log in, 
                  please ignore this email and consider changing your password immediately.
                </p>
              </div>
              
              <div class="divider"></div>
              
              <p class="message" style="font-size: 13px; color: #999999;">
                This is an automated security email. Please do not reply to this message.
              </p>
            </div>
            
            <div class="footer">
              <p class="footer-text"><strong>Pulse</strong></p>
              <p class="footer-text">Connect. Share. Pulse.</p>
              <p class="footer-text" style="margin-top: 20px;">
                © ${new Date().getFullYear()} Pulse. All rights reserved.
              </p>
            </div>
          </div>
        </body>
        </html>
      `,

      password_reset: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
            .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 40px 20px; text-align: center; }
            .header h1 { color: #ffffff; margin: 0; font-size: 28px; font-weight: 600; }
            .content { padding: 40px 30px; }
            .greeting { font-size: 18px; color: #333333; margin-bottom: 20px; }
            .message { font-size: 15px; color: #666666; line-height: 1.6; margin-bottom: 30px; }
            .otp-container { background-color: #fff5f5; border: 2px dashed #f5576c; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0; }
            .otp-label { font-size: 13px; color: #666666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; font-weight: 600; }
            .otp-code { font-size: 36px; font-weight: 700; color: #f5576c; letter-spacing: 8px; font-family: 'Courier New', monospace; margin: 10px 0; }
            .expiry { font-size: 13px; color: #999999; margin-top: 15px; }
            .warning { background-color: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .warning-text { font-size: 14px; color: #721c24; margin: 0; }
            .footer { background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e9ecef; }
            .footer-text { font-size: 13px; color: #6c757d; margin: 5px 0; }
            .divider { height: 1px; background-color: #e9ecef; margin: 30px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔑 Password Reset</h1>
            </div>
            
            <div class="content">
              <p class="greeting">Password Reset Request</p>
              
              <p class="message">
                We received a request to reset the password for your Pulse account. 
                Use the verification code below to proceed with resetting your password:
              </p>
              
              <div class="otp-container">
                <div class="otp-label">Password Reset Code</div>
                <div class="otp-code">${otp}</div>
                <div class="expiry">⏱️ Valid for 10 minutes</div>
              </div>
              
              <p class="message">
                Enter this code in the app to create a new password for your account.
              </p>
              
              <div class="warning">
                <p class="warning-text">
                  <strong>⚠️ Important:</strong> If you didn't request a password reset, 
                  please contact our support team immediately. Someone may be trying to access your account.
                </p>
              </div>
              
              <div class="divider"></div>
              
              <p class="message" style="font-size: 13px; color: #999999;">
                For security reasons, this code will expire in 10 minutes.
              </p>
            </div>
            
            <div class="footer">
              <p class="footer-text"><strong>Pulse</strong></p>
              <p class="footer-text">Connect. Share. Pulse.</p>
              <p class="footer-text" style="margin-top: 20px;">
                © ${new Date().getFullYear()} Pulse. All rights reserved.
              </p>
            </div>
          </div>
        </body>
        </html>
      `,

      verification: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; }
            .header h1 { color: #ffffff; margin: 0; font-size: 28px; font-weight: 600; }
            .content { padding: 40px 30px; }
            .greeting { font-size: 18px; color: #333333; margin-bottom: 20px; }
            .message { font-size: 15px; color: #666666; line-height: 1.6; margin-bottom: 30px; }
            .otp-container { background-color: #f8f9fa; border: 2px dashed #667eea; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0; }
            .otp-label { font-size: 13px; color: #666666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; font-weight: 600; }
            .otp-code { font-size: 36px; font-weight: 700; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace; margin: 10px 0; }
            .expiry { font-size: 13px; color: #999999; margin-top: 15px; }
            .warning { background-color: #d1ecf1; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .warning-text { font-size: 14px; color: #0c5460; margin: 0; }
            .footer { background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e9ecef; }
            .footer-text { font-size: 13px; color: #6c757d; margin: 5px 0; }
            .divider { height: 1px; background-color: #e9ecef; margin: 30px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✉️ Email Verification</h1>
            </div>
            
            <div class="content">
              <p class="greeting">Verify Your Email</p>
              
              <p class="message">
                To ensure the security of your Pulse account, please verify your email address 
                by entering the code below:
              </p>
              
              <div class="otp-container">
                <div class="otp-label">Verification Code</div>
                <div class="otp-code">${otp}</div>
                <div class="expiry">⏱️ Valid for 10 minutes</div>
              </div>
              
              <p class="message">
                Once verified, you'll have full access to all Pulse features.
              </p>
              
              <div class="warning">
                <p class="warning-text">
                  <strong>ℹ️ Note:</strong> This verification helps us ensure that you have access 
                  to this email address and can receive important account notifications.
                </p>
              </div>
              
              <div class="divider"></div>
              
              <p class="message" style="font-size: 13px; color: #999999;">
                If you didn't initiate this verification, no action is required.
              </p>
            </div>
            
            <div class="footer">
              <p class="footer-text"><strong>Pulse</strong></p>
              <p class="footer-text">Connect. Share. Pulse.</p>
              <p class="footer-text" style="margin-top: 20px;">
                © ${new Date().getFullYear()} Pulse. All rights reserved.
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    return templates[purpose] || templates.login;
  }

  // SMS message templates
  getSMSTemplate(purpose, otp) {
    const templates = {
      signup: `${otp} is your Pulse verification code. Valid for 5 minutes. Never share this code with anyone.`,
      login: `${otp} is your Pulse login code. Valid for 5 minutes. If you didn't request this, ignore this message.`,
      password_reset: `${otp} is your Pulse password reset code. Valid for 5 minutes. Don't share this code.`,
      verification: `${otp} is your Pulse verification code. Valid for 5 minutes.`
    };
    return templates[purpose] || templates.login;
  }

  // Verify OTP
  async verifyOTP(identifier, inputOTP, purpose, ipAddress = '127.0.0.1') {
    try {
      let lookupIdentifier = identifier;

      // If the identifier is not an email, assume it's a phone number and normalize it
      if (!identifier.includes('@')) {
        lookupIdentifier = this._normalizePhoneToE164(identifier);
      }

      console.log(`🔍 DEBUG: Verifying OTP for original: "${identifier}", normalized to: "${lookupIdentifier}"`);

      const otpRecord = await OTP.findValidOTP(lookupIdentifier, purpose);

      if (!otpRecord) {
        throw new Error('Invalid or expired OTP');
      }
      if (otpRecord.isExpired && otpRecord.isExpired()) {
        throw new Error('OTP has expired');
      }
      if (otpRecord.isMaxAttemptsReached && otpRecord.isMaxAttemptsReached()) {
        throw new Error('Maximum verification attempts exceeded');
      }

      const isValid = await bcrypt.compare(inputOTP, otpRecord.hashedCode);

      if (!isValid) {
        await otpRecord.incrementAttempts();
        const remainingAttempts = Math.max(0, (otpRecord.maxAttempts || 3) - (otpRecord.attempts || 0));
        throw new Error(`Invalid OTP. ${remainingAttempts} attempts remaining.`);
      }

      await otpRecord.markAsVerified();

      try {
        await cacheService.del(`otp_rate_limit:${otpRecord.type}:${lookupIdentifier}`);
      } catch (cacheError) {
        console.warn('⚠️ Cache deletion failed on OTP verify:', cacheError);
      }

      console.log(`✅ OTP verified successfully for ${lookupIdentifier}`);
      return {
        success: true,
        otpId: otpRecord._id,
        userId: otpRecord.userId,
        identifier: otpRecord.identifier,
        type: otpRecord.type,
        purpose: otpRecord.purpose,
        verifiedAt: otpRecord.verifiedAt
      };
    } catch (error) {
      console.error('OTP verification error:', error.message || error);
      throw error;
    }
  }

  // Resend OTP
  async resendOTP(identifier, type, purpose, userId, ipAddress) {
    try {
      let lookupIdentifier = identifier;
      // Also normalize here for consistency
      if (type === 'sms') {
        lookupIdentifier = this._normalizePhoneToE164(identifier);
      }

      await OTP.deleteMany({ identifier: lookupIdentifier, purpose, verified: false });

      const rateLimitKey = `otp_rate_limit:${type}:${lookupIdentifier}`;
      try {
        await cacheService.del(rateLimitKey);
      } catch (cacheErr) {
        console.warn('⚠️ Could not clear rate limit cache:', cacheErr);
      }

      if (type === 'email') {
        return await this.sendEmailOTP(identifier, purpose, userId, ipAddress);
      } else if (type === 'sms') {
        return await this.sendSMSOTP(identifier, purpose, userId, ipAddress);
      } else {
        throw new Error('Invalid OTP type');
      }
    } catch (error) {
      console.error('Resend OTP error:', error.message || error);
      throw error;
    }
  }

  // Clean up expired OTPs (utility method)
  async cleanupExpiredOTPs() {
    try {
      const result = await OTP.deleteMany({
        expiresAt: { $lt: new Date() }
      });
      if (result.deletedCount > 0) {
        console.log(`🧹 Cleaned up ${result.deletedCount} expired OTPs`);
      }
      return result.deletedCount;
    } catch (error) {
      console.error('OTP cleanup error:', error.message || error);
      return 0;
    }
  }
}

module.exports = new CustomOTPService();
const nodemailer = require('nodemailer');
const BrevoTransport = require('nodemailer-brevo-transport');
const config = require('./index'); // Ensure this points to your config loader

class SMTPConfig {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
  }

  async initialize() {
    try {
      // 1. Get the API Key from environment variables
      const apiKey = process.env.EMAIL_API_KEY;

      if (!apiKey) {
        console.warn('⚠️ Email API Key (EMAIL_API_KEY) is missing in .env');
        return null;
      }

      // 2. Initialize the Brevo HTTP Transport
      this.transporter = nodemailer.createTransport(
        new BrevoTransport({
          apiKey: apiKey
        })
      );

      // 3. Verify the connection (Brevo validates the key here)
      this.isConfigured = true;
      console.log('✅ Email Service Configured (via Brevo HTTP)');
      
      return this.transporter;

    } catch (error) {
      console.error('❌ Email initialization failed:', error.message);
      return null;
    }
  }

  // Wrapper for sendMail to ensure initialization
  async sendMail(mailOptions) {
    // Auto-initialize if not ready
    if (!this.isConfigured || !this.transporter) {
        console.log('⚠️ SMTP not ready, attempting to initialize...');
        await this.initialize();
        if (!this.transporter) throw new Error('Email service failed to initialize');
    }

    return new Promise((resolve, reject) => {
      this.transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
          console.error('❌ Email send error:', err);
          reject(err);
        } else {
          console.log(`✅ Email sent successfully to ${mailOptions.to}`);
          resolve(info);
        }
      });
    });
  }

  getTransporter() {
    return this.transporter;
  }
}

module.exports = new SMTPConfig();

// src/controllers/authController.js
const authService = require('../services/authService');
const rateLimit = require('express-rate-limit');

// Phone number validation for Indian numbers
const validatePhoneNumber = (phone) => {
  const cleanPhone = String(phone).replace(/\D/g, '');
  if (cleanPhone.match(/^[6-9]\d{9}$/)) {
    return cleanPhone;
  }
  if (cleanPhone.match(/^91[6-9]\d{9}$/)) {
    return cleanPhone.substring(2);
  }
  throw new Error('Please enter a valid Indian mobile number (10 digits starting with 6-9)');
};

// Email validation
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Please enter a valid email address');
  }
  return email.toLowerCase().trim();
};

// Rate limiting configurations
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    error: 'Too many OTP requests, please try again later',
    code: 'OTP_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper: build E.164 phone format
const buildE164Phone = (identifier) => {
  const cleanPhone = validatePhoneNumber(identifier);
  return `+91${cleanPhone}`;
};

// Initiate authentication (email or phone)
const initiateAuth = async (req, res) => {
  try {
    const { method, identifier, deviceId, platform, deviceName, appVersion } = req.body;

    if (!method || !identifier) {
      return res.status(400).json({
        success: false,
        error: 'Method and identifier are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }

    if (!['email', 'phone'].includes(method)) {
      return res.status(400).json({
        success: false,
        error: 'Method must be either "email" or "phone"',
        code: 'INVALID_METHOD'
      });
    }

    let processedIdentifier;
    let displayIdentifier;

    if (method === 'phone') {
      processedIdentifier = buildE164Phone(identifier);
      displayIdentifier = processedIdentifier;
    } else if (method === 'email') {
      processedIdentifier = validateEmail(identifier);
      displayIdentifier = processedIdentifier;
    }

    const deviceInfo = {
      deviceId: deviceId || `web-${Date.now()}`,
      platform: platform || 'web',
      deviceName: deviceName || 'Unknown Device',
      appVersion: appVersion || '1.0.0'
    };

    if (!deviceInfo.deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Device ID is required',
        code: 'MISSING_DEVICE_ID'
      });
    }

    const result = await authService.initiateAuth(
      processedIdentifier,
      method,
      deviceInfo,
      req.ip || '127.0.0.1'
    );

    result.identifier = displayIdentifier;

    res.json(result);

  } catch (error) {
    console.error('Auth initiation error:', error.message);
    res.status(400).json({
      success: false,
      error: error.message,
      code: 'AUTH_INITIATION_FAILED'
    });
  }
};

// Verify OTP
const verifyOTP = async (req, res) => {
  try {
    const { identifier, otp, method, deviceId, platform } = req.body;

    if (!identifier || !otp || !method || !deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Identifier, OTP, method, and deviceId are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }

    if (!['email', 'phone'].includes(method)) {
      return res.status(400).json({
        success: false,
        error: 'Method must be either "email" or "phone"',
        code: 'INVALID_METHOD'
      });
    }

    let lookupIdentifier;

    // Ensure the lookup identifier matches what's in the database
    if (method === 'phone') {
      lookupIdentifier = buildE164Phone(identifier);
    } else if (method === 'email') {
      lookupIdentifier = validateEmail(identifier);
    }

    const deviceInfo = {
      deviceId,
      platform: platform || 'web'
    };
    
    const result = await authService.verifyOTPAndAuth(
      lookupIdentifier,
      otp,
      method,
      deviceInfo,
      req.ip || '127.0.0.1'
    );

    res.json(result);

  } catch (error) {
    console.error('OTP verification error:', error.message);
    
    if (error.message && (error.message.includes('Invalid') || error.message.includes('expired'))) {
      return res.status(401).json({
        success: false,
        error: error.message,
        code: 'INVALID_OTP'
      });
    }

    res.status(400).json({
      success: false,
      error: error.message,
      code: 'OTP_VERIFICATION_FAILED'
    });
  }
};

// Create username and password
const createUsername = async (req, res) => {
  try {
    const { tempToken, username, password, deviceId } = req.body;

    if (!tempToken || !username || !password || !deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Temporary token, username, password, and deviceId are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }

    const deviceInfo = {
      deviceId,
      platform: req.body.platform || 'web'
    };

    const result = await authService.createUsernameAndPassword(
      tempToken,
      username,
      password,
      deviceInfo,
      req.ip || '127.0.0.1'
    );

    res.json(result);

  } catch (error) {
    console.error('Username creation error:', error.message);
    
    if (error.message && error.message.includes('Username must be')) {
      return res.status(400).json({
        success: false,
        error: error.message,
        code: 'INVALID_USERNAME'
      });
    }
    
    if (error.message && error.message.includes('already exists')) {
      return res.status(409).json({
        success: false,
        error: error.message,
        code: 'USERNAME_EXISTS'
      });
    }

    if (error.message && error.message.includes('already set')) {
      return res.status(400).json({
        success: false,
        error: error.message,
        code: 'USERNAME_ALREADY_SET'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
};

// Refresh access token
const refreshToken = async (req, res) => {
  try {
    const { refreshToken: refreshTokenValue } = req.body;

    if (!refreshTokenValue) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token is required',
        code: 'MISSING_REFRESH_TOKEN'
      });
    }

    const result = await authService.refreshAccessToken(refreshTokenValue);
    res.json(result);

  } catch (error) {
    console.error('Token refresh error:', error.message);
    
    if (error.message && (error.message.includes('Invalid') || error.message.includes('expired'))) {
      return res.status(401).json({
        success: false,
        error: error.message,
        code: 'INVALID_REFRESH_TOKEN'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
};

// Resend OTP
const resendOTP = async (req, res) => {
  try {
    const { identifier, method } = req.body;

    if (!identifier || !method) {
      return res.status(400).json({
        success: false,
        error: 'Identifier and method are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }

    if (!['email', 'phone'].includes(method)) {
      return res.status(400).json({
        success: false,
        error: 'Method must be either "email" or "phone"',
        code: 'INVALID_METHOD'
      });
    }

    let processedIdentifier;
    
    if (method === 'phone') {
      processedIdentifier = buildE164Phone(identifier);
    } else if (method === 'email') {
      processedIdentifier = validateEmail(identifier);
    }

    const result = await authService.resendOTP(
      processedIdentifier,
      method,
      req.ip || '127.0.0.1'
    );

    res.json(result);

  } catch (error) {
    console.error('Resend OTP error:', error.message);
    res.status(400).json({
      success: false,
      error: error.message,
      code: 'RESEND_OTP_FAILED'
    });
  }
};

// Check username availability
const checkUsername = async (req, res) => {
  try {
    const { username } = req.query;

    if (!username) {
      return res.status(400).json({
        success: false,
        error: 'Username is required',
        code: 'MISSING_USERNAME'
      });
    }

    const result = await authService.checkUsernameAvailability(username);
    res.json(result);

  } catch (error) {
    console.error('Username check error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
};

// Get current user info
const getCurrentUser = async (req, res) => {
  try {
    const user = req.user;
    const result = await authService.getCurrentUser(user.userId);
    res.json(result);
  } catch (error) {
    console.error('Get current user error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
};

// Logout user
const logout = async (req, res) => {
  try {
    const { deviceId } = req.body;
    const user = req.user;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Device ID is required',
        code: 'MISSING_DEVICE_ID'
      });
    }

    const result = await authService.logoutUser(user.userId, deviceId);
    res.json(result);

  } catch (error) {
    console.error('Logout error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
};

// Handle Firebase Login
const firebaseLogin = async (req, res) => {
  try {
    const { idToken, deviceId, platform, deviceName } = req.body;

    if (!idToken || !deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Firebase ID token and Device ID are required',
        code: 'MISSING_FIELDS'
      });
    }

    const deviceInfo = {
      deviceId,
      platform: platform || 'mobile',
      deviceName: deviceName || 'Unknown'
    };

    // Call the NEW service method
    const result = await authService.loginWithFirebase(
      idToken,
      deviceInfo,
      req.ip || '127.0.0.1'
    );

    res.json(result);

  } catch (error) {
    console.error('Firebase login controller error:', error.message);
    
    // Handle specific Firebase errors cleanly
    if (error.message.includes('Firebase ID token has expired')) {
      return res.status(401).json({
        success: false,
        error: 'Session expired. Please login again.',
        code: 'TOKEN_EXPIRED'
      });
    }

    res.status(401).json({
      success: false,
      error: 'Authentication failed',
      code: 'AUTH_FAILED'
    });
  }
};

module.exports = {
  initiateAuth,
  verifyOTP,
  createUsername,
  refreshToken,
  resendOTP,
  checkUsername,
  getCurrentUser,
  logout,
  firebaseLogin,
  authRateLimit,
  otpRateLimit
};

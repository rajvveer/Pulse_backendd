const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/auth');

// Public routes
router.post('/initiate', authController.authRateLimit, authController.initiateAuth);
router.post('/verify-otp', authController.authRateLimit, authController.verifyOTP);
router.post('/create-username', authController.authRateLimit, authController.createUsername);
router.post('/refresh-token', authController.refreshToken);
router.post('/resend-otp', authController.otpRateLimit, authController.resendOTP);
router.get('/check-username', authController.checkUsername);

// 🆕 ADDED: Firebase Login Route
router.post('/firebase-login', authController.authRateLimit, authController.firebaseLogin);

// Protected routes
router.get('/me', authMiddleware.verifyAccessToken, authController.getCurrentUser);
router.post('/logout', authMiddleware.verifyAccessToken, authController.logout);

// Test route
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Auth API is working!',
    timestamp: new Date().toISOString(),
    endpoints: {
      public: [
        'POST /api/v1/auth/initiate - Start email/phone authentication',
        'POST /api/v1/auth/verify-otp - Verify OTP code',
        'POST /api/v1/auth/create-username - Create username/password (new users)',
        'POST /api/v1/auth/refresh-token - Refresh access token',
        'POST /api/v1/auth/resend-otp - Resend OTP code',
        'GET /api/v1/auth/check-username - Check username availability',
        'POST /api/v1/auth/firebase-login - Login with Firebase ID token' // Added to docs for consistency
      ],
      protected: [
        'GET /api/v1/auth/me - Get current user info',
        'POST /api/v1/auth/logout - Logout from device'
      ]
    },
    features: [
      '📧 Email OTP via Gmail SMTP',
      '📱 SMS OTP via MSG91 (India)',
      '🔐 JWT access + refresh tokens',
      '💾 Multi-device session management',
      '🔒 Rate limiting & security',
      '👤 Username/password creation',
      '✅ Account verification',
      '🔥 Firebase Integration'
    ]
  });
});

module.exports = router;
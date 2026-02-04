const jwtService = require('../services/jwtService');
const User = require('../models/User');
const cacheService = require('../services/cacheService');

class AuthMiddleware {
  // Verify access token middleware
  async verifyAccessToken(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Access token required',
          code: 'MISSING_ACCESS_TOKEN'
        });
      }

      const token = authHeader.split(' ')[1];
      
      // Verify token
      const decoded = jwtService.verifyAccessToken(token);
      
      // Check user exists and is active
      const user = await User.findById(decoded.userId);
      if (!user || !user.isActive) {
        return res.status(401).json({
          success: false,
          error: 'User not found or inactive',
          code: 'USER_NOT_FOUND'
        });
      }

      // Attach user info to request
      req.user = {
        userId: decoded.userId,
        username: decoded.username,
        email: decoded.email,
        isVerified: decoded.isVerified
      };

      next();

    } catch (error) {
      console.error('Auth middleware error:', error);

      if (error.message.includes('expired')) {
        return res.status(401).json({
          success: false,
          error: 'Access token expired',
          code: 'TOKEN_EXPIRED'
        });
      }

      if (error.message.includes('Invalid')) {
        return res.status(401).json({
          success: false,
          error: 'Invalid access token',
          code: 'INVALID_TOKEN'
        });
      }

      res.status(401).json({
        success: false,
        error: 'Authentication failed',
        code: 'AUTH_FAILED'
      });
    }
  }

  // Optional auth middleware (doesn't fail if no token)
  async optionalAuth(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.user = null;
        return next();
      }

      const token = authHeader.split(' ')[1];
      const decoded = jwtService.verifyAccessToken(token);
      
      const user = await User.findById(decoded.userId);
      if (user && user.isActive) {
        req.user = {
          userId: decoded.userId,
          username: decoded.username,
          email: decoded.email,
          isVerified: decoded.isVerified
        };
      } else {
        req.user = null;
      }

      next();

    } catch (error) {
      // Silent fail for optional auth
      req.user = null;
      next();
    }
  }

  // Check if user is verified
  requireVerified(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!req.user.isVerified) {
      return res.status(403).json({
        success: false,
        error: 'Account verification required',
        code: 'VERIFICATION_REQUIRED'
      });
    }

    next();
  }

  // Admin only middleware
  async requireAdmin(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      const user = await User.findById(req.user.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Admin access required',
          code: 'ADMIN_REQUIRED'
        });
      }

      next();

    } catch (error) {
      console.error('Admin middleware error:', error);
      res.status(500).json({
        success: false,
        error: 'Authorization check failed',
        code: 'AUTH_CHECK_FAILED'
      });
    }
  }
}

module.exports = new AuthMiddleware();

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class JWTService {
  constructor() {
    this.accessTokenSecret = process.env.JWT_SECRET;
    this.refreshTokenSecret = process.env.JWT_REFRESH_SECRET;
    this.tempTokenSecret = process.env.TEMP_JWT_SECRET;
    
    if (!this.accessTokenSecret || !this.refreshTokenSecret || !this.tempTokenSecret) {
      throw new Error('JWT secrets not configured properly in environment variables');
    }
  }

  // Generate access token (short-lived)
  generateAccessToken(payload) {
    const tokenPayload = {
      userId: payload.userId,
      username: payload.username,
      email: payload.email,
      isVerified: payload.isVerified,
      type: 'access'
    };

    return jwt.sign(tokenPayload, this.accessTokenSecret, {
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
      issuer: 'pulse-app',
      audience: 'pulse-users'
    });
  }

  // Generate refresh token (long-lived)
  generateRefreshToken(payload) {
    const tokenPayload = {
      userId: payload.userId,
      deviceId: payload.deviceId,
      type: 'refresh',
      tokenId: crypto.randomBytes(16).toString('hex') // Unique token ID
    };

    return jwt.sign(tokenPayload, this.refreshTokenSecret, {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
      issuer: 'pulse-app',
      audience: 'pulse-users'
    });
  }

  // Generate temporary token (for username creation flow)
  generateTempToken(payload) {
    const tokenPayload = {
      userId: payload.userId,
      purpose: payload.purpose || 'username_creation',
      type: 'temporary'
    };

    return jwt.sign(tokenPayload, this.tempTokenSecret, {
      expiresIn: '10m', // Short-lived for security
      issuer: 'pulse-app',
      audience: 'pulse-users'
    });
  }

  // Verify access token
  verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, this.accessTokenSecret, {
        issuer: 'pulse-app',
        audience: 'pulse-users'
      });
      
      if (decoded.type !== 'access') {
        throw new Error('Invalid token type');
      }
      
      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Access token expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid access token');
      } else {
        throw error;
      }
    }
  }

  // Verify refresh token
  verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, this.refreshTokenSecret, {
        issuer: 'pulse-app',
        audience: 'pulse-users'
      });
      
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }
      
      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Refresh token expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid refresh token');
      } else {
        throw error;
      }
    }
  }

  // Verify temporary token
  verifyTempToken(token) {
    try {
      const decoded = jwt.verify(token, this.tempTokenSecret, {
        issuer: 'pulse-app',
        audience: 'pulse-users'
      });
      
      if (decoded.type !== 'temporary') {
        throw new Error('Invalid token type');
      }
      
      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Temporary token expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid temporary token');
      } else {
        throw error;
      }
    }
  }

  // Generate token pair (access + refresh)
  generateTokenPair(user, deviceId) {
    const payload = {
      userId: user._id.toString(),
      username: user.username,
      email: user.email,
      isVerified: user.isVerified,
      deviceId
    };

    const accessToken = this.generateAccessToken(payload);
    const refreshToken = this.generateRefreshToken(payload);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 900, // 15 minutes in seconds
      refreshExpiresIn: 604800 // 7 days in seconds
    };
  }

  // Decode token without verification (for debugging)
  decodeToken(token) {
    return jwt.decode(token, { complete: true });
  }

  // Extract user ID from token (without full verification)
  extractUserId(token) {
    try {
      const decoded = jwt.decode(token);
      return decoded?.userId || null;
    } catch (error) {
      return null;
    }
  }

  // Check if token is expired without throwing
  isTokenExpired(token) {
    try {
      const decoded = jwt.decode(token);
      if (!decoded?.exp) return true;
      
      const currentTime = Math.floor(Date.now() / 1000);
      return decoded.exp < currentTime;
    } catch (error) {
      return true;
    }
  }
}

// Export singleton instance
module.exports = new JWTService();

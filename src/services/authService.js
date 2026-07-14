const User = require('../models/User');
const Session = require('../models/Session');
const OTP = require('../models/OTP');
const jwtService = require('./jwtService');
const customOTPService = require('./customOTPService');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const firebaseConfig = require('../config/firebase');
const cacheService = require('./cacheService');

// Tokens are stored in MongoDB as SHA-256 hashes so a database leak does not
// expose live credentials. Lookups hash the incoming token before matching.
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

class AuthService {
  // Initiate authentication process (EMAIL + PHONE)
  async initiateAuth(identifier, method, deviceInfo, ipAddress) {
  try {
    console.log(`🚀 Initiating ${method} auth for: ${identifier}`);

    // Validate method
    if (!['email', 'phone'].includes(method)) {
      throw new Error('Unsupported authentication method');
    }

    // Check if user already exists
    let existingUser;
    let processedIdentifier = identifier;

    if (method === 'email') {
      existingUser = await User.findByAuthMethod('email', identifier);
    } else if (method === 'phone') {
      // Clean phone number properly
      const cleanPhone = identifier.replace(/\D/g, '');
      
      if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
        processedIdentifier = cleanPhone;
      } else if (cleanPhone.length === 10) {
        processedIdentifier = `91${cleanPhone}`;
      } else {
        throw new Error('Invalid phone number format');
      }
      
      existingUser = await User.findByAuthMethod('phone', `+${processedIdentifier}`);
    }

    const userExists = !!existingUser;
    const purpose = userExists ? 'login' : 'signup';
    
    console.log(`👤 User exists: ${userExists}, Purpose: ${purpose}`);

    // Send OTP based on method
    let otpResult;
    if (method === 'email') {
      otpResult = await customOTPService.sendEmailOTP(
        identifier, 
        purpose, 
        existingUser?._id, 
        ipAddress
      );
    } else if (method === 'phone') {
      // Use 10-digit part for SMS
      const phoneForSMS = processedIdentifier.substring(2);
      otpResult = await customOTPService.sendSMSOTP(
        phoneForSMS, 
        purpose, 
        existingUser?._id, 
        ipAddress
      );
    }

    return {
      success: true,
      method,
      identifier: method === 'phone' ? `+${processedIdentifier}` : identifier,
      nextStep: 'verify_otp',
      purpose,
      userExists,
      message: `OTP sent to ${method === 'phone' ? `+${processedIdentifier}` : identifier}`
    };

  } catch (error) {
    console.error(`${method} auth initiation error:`, error.message);
    throw error;
  }
}
async loginWithFirebase(idToken, accessToken, deviceInfo, ipAddress, extraInfo = {}) {
    try {
      let email, name, picture, googleId;

      // Strategy 1: Try Firebase Admin SDK verification first (works with Firebase ID tokens)
      let firebaseVerified = false;
      if (idToken && firebaseConfig.isAvailable()) {
        try {
          const decodedToken = await firebaseConfig.verifyIdToken(idToken);
          email = decodedToken.email;
          name = decodedToken.name;
          picture = decodedToken.picture;
          googleId = decodedToken.uid;
          firebaseVerified = true;
          console.log(`🔥 Firebase token verified for: ${email}`);
        } catch (fbErr) {
          console.log(`⚠️ Firebase verification failed (expected for Google OAuth tokens): ${fbErr.message}`);
        }
      }

      // Strategy 2: Verify Google access token directly via Google's API
      // Use the accessToken (OAuth token) which works with Google's userinfo endpoint
      const googleToken = accessToken || idToken;
      if (!firebaseVerified && googleToken) {
        try {
          const googleResponse = await fetch(
            `https://www.googleapis.com/oauth2/v3/userinfo`,
            {
              headers: { Authorization: `Bearer ${googleToken}` }
            }
          );

          if (googleResponse.ok) {
            const googleUser = await googleResponse.json();
            email = googleUser.email;
            name = googleUser.name;
            picture = googleUser.picture;
            googleId = googleUser.sub;
            console.log(`✅ Google token verified via userinfo API for: ${email}`);
          } else {
            // Try tokeninfo endpoint as fallback
            const tokenInfoResponse = await fetch(
              `https://oauth2.googleapis.com/tokeninfo?access_token=${googleToken}`
            );
            
            if (tokenInfoResponse.ok) {
              const tokenInfo = await tokenInfoResponse.json();
              email = tokenInfo.email;
              googleId = tokenInfo.sub;
              // tokeninfo doesn't return name/picture, use extraInfo from frontend
              name = extraInfo.name;
              picture = extraInfo.picture;
              console.log(`✅ Google token verified via tokeninfo API for: ${email}`);
            } else {
              throw new Error('Google token verification failed');
            }
          }
        } catch (googleErr) {
          console.error('❌ Google token verification failed:', googleErr.message);
          throw new Error('Invalid authentication token');
        }
      }

      if (!email) {
        throw new Error('Could not determine email from authentication token');
      }

      const identifier = email;
      const method = 'email';

      console.log(`🔥 Google Login: ${method} - ${identifier}`);

      // Check if user already exists in database
      let user = await User.findByAuthMethod(method, identifier);

      if (!user) {
        console.log(`👤 Creating new user from Google: ${identifier}`);
        
        user = await this.createNewUser(method, identifier, { 
          verified: true,
          via: 'google'
        });

        // Update profile with Google info
        if (picture && !user.avatar) user.avatar = picture;
        if (name && !user.name) user.name = name;
        if (googleId) user.googleId = googleId;
        await user.save();
      } else {
        await this.updateUserAuthMethod(user, method, identifier);
        // Update Google profile info if newer
        if (picture && !user.avatar) user.avatar = picture;
        if (name && !user.name) user.name = name;
        await user.save();
      }

      // Check if user needs to create username (new users from Google)
      if (!user.username) {
        const tempToken = jwtService.generateTempToken({
          userId: user._id,
          purpose: 'username_creation'
        });

        return {
          success: true,
          nextStep: 'create_username',
          requiresUsername: true,
          tempToken,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            isVerified: user.isVerified
          },
          message: 'Please create a username and password'
        };
      }

      // Create Session — same tokens as OTP flow
      const sessionResult = await this.createUserSession(user, deviceInfo, ipAddress);
      
      return {
        success: true,
        nextStep: 'complete',
        user: this.sanitizeUser(user),
        accessToken: sessionResult.tokens.accessToken,
        refreshToken: sessionResult.tokens.refreshToken,
        tokens: sessionResult.tokens,
        session: sessionResult.session,
        message: 'Authentication successful'
      };

    } catch (error) {
      console.error('Google login service error:', error.message);
      throw error;
    }
  }

  // Verify OTP and proceed with auth flow
  async verifyOTPAndAuth(identifier, otp, method, deviceInfo, ipAddress) {
    try {
      // Determine purpose the same way as in initiate
      let existingUser;
      
      if (method === 'email') {
        existingUser = await User.findByAuthMethod('email', identifier);
      } else if (method === 'phone') {
        // identifier comes as +919876543210, convert for lookup
        const cleanIdentifier = identifier.replace('+', '');
        existingUser = await User.findByAuthMethod('phone', identifier);
      }

      const purpose = existingUser ? 'login' : 'signup';
      
      console.log(`🔍 DEBUG: Verifying OTP with purpose: ${purpose}`);
      
      // Verify OTP with correct purpose
      const otpResult = await customOTPService.verifyOTP(
        identifier, 
        otp, 
        purpose, 
        ipAddress
      );

      // Check if user exists (get fresh data)
      if (method === 'email') {
        existingUser = await User.findByAuthMethod('email', identifier);
      } else if (method === 'phone') {
        existingUser = await User.findByAuthMethod('phone', identifier);
      }
      
      if (!existingUser) {
        // Create new user for signup
        existingUser = await this.createNewUser(method, identifier, otpResult);
      } else {
        // Update existing user verification status
        await this.updateUserAuthMethod(existingUser, method, identifier);
      }

      // Check if user needs to create username
      if (!existingUser.username) {
        const tempToken = jwtService.generateTempToken({
          userId: existingUser._id,
          purpose: 'username_creation'
        });

        return {
          success: true,
          nextStep: 'create_username',
          tempToken,
          user: {
            id: existingUser._id,
            name: existingUser.name,
            email: existingUser.email,
            phone: existingUser.phone,
            isVerified: existingUser.isVerified
          },
          message: 'Please create a username and password'
        };
      }

      // Generate session and tokens
      const sessionResult = await this.createUserSession(existingUser, deviceInfo, ipAddress);
      
      return {
        success: true,
        nextStep: 'complete',
        user: this.sanitizeUser(existingUser),
        tokens: sessionResult.tokens,
        session: {
          deviceId: sessionResult.session.deviceId,
          expiresAt: sessionResult.session.expiresAt
        },
        message: 'Authentication successful'
      };

    } catch (error) {
      console.error('OTP verification error:', error.message);
      throw error;
    }
  }

  // Create new user (EMAIL + PHONE)
  async createNewUser(method, identifier, otpResult) {
    try {
      console.log(`👤 Creating new user for ${method}: ${identifier}`);

      let userData = {
        name: method === 'email' ? identifier.split('@')[0] : `user_${identifier.slice(-4)}`,
        authMethods: [{
          type: method,
          identifier: method === 'phone' ? identifier : identifier, // Keep + for phone
          verified: true,
          verifiedAt: new Date()
        }],
        isVerified: true,
        lastLoginAt: new Date(),
        stats: {
          postsCount: 0,
          likesReceived: 0,
          commentsReceived: 0
        },
        settings: {
          radius: 1000,
          shareExactLocation: false,
          anonymousPosting: false,
          pushNotifications: true,
          emailNotifications: true
        }
      };

      // Set email or phone field
      if (method === 'email') {
        userData.email = identifier;
      } else if (method === 'phone') {
        userData.phone = identifier; // identifier already has + sign
      }

      const newUser = await User.create(userData);
      console.log(`✅ New user created: ${newUser._id}`);
      
      return newUser;

    } catch (error) {
      console.error('New user creation error:', error.message);
      throw error;
    }
  }

  // Update existing user's auth method
  async updateUserAuthMethod(user, method, identifier) {
    try {
      // Check if this auth method already exists
      const existingMethod = user.authMethods.find(
        am => am.type === method && am.identifier === identifier
      );

      if (!existingMethod) {
        // Add new auth method
        user.authMethods.push({
          type: method,
          identifier: identifier,
          verified: true,
          verifiedAt: new Date()
        });
      } else {
        // Update existing method
        existingMethod.verified = true;
        existingMethod.verifiedAt = new Date();
      }

      // Update main fields if not set
      if (method === 'email' && !user.email) {
        user.email = identifier;
      } else if (method === 'phone' && !user.phone) {
        user.phone = identifier;
      }

      user.isVerified = true;
      user.lastLoginAt = new Date();

      await user.save();
      console.log(`✅ Updated auth method for user: ${user._id}`);

    } catch (error) {
      console.error('Update user auth method error:', error.message);
      throw error;
    }
  }

  // Create username and password
  async createUsernameAndPassword(tempToken, username, password, deviceInfo, ipAddress) {
    try {
      // Verify temp token
      const decoded = jwtService.verifyTempToken(tempToken);
      
      if (decoded.purpose !== 'username_creation') {
        throw new Error('Invalid temporary token purpose');
      }

      // Get user
      const user = await User.findById(decoded.userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if username already set
      if (user.username) {
        throw new Error('Username already set for this user');
      }

      // Check username availability
      const existingUser = await User.findOne({ 
        username: username.toLowerCase(),
        isActive: true 
      });
      
      if (existingUser) {
        throw new Error('Username already exists');
      }

      // Validate username
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        throw new Error('Username must be 3-20 characters, alphanumeric and underscores only');
      }

      // Validate password
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters long');
      }

      console.log(`Username created for user: ${user._id}`);

      // Hash password and set username
      const passwordHash = await bcrypt.hash(password, 12);
      user.username = username;
      user.passwordHash = passwordHash;
      user.updatedAt = new Date();
      
      await user.save();

      // Generate session and tokens
      const sessionResult = await this.createUserSession(user, deviceInfo, ipAddress);
      
      return {
        success: true,
        user: this.sanitizeUser(user),
        tokens: sessionResult.tokens,
        session: {
          deviceId: sessionResult.session.deviceId,
          expiresAt: sessionResult.session.expiresAt
        },
        message: 'Account setup completed successfully'
      };

    } catch (error) {
      console.error('Username creation error:', error.message);
      throw error;
    }
  }

  // Create user session
  async createUserSession(user, deviceInfo, ipAddress) {
    try {
      // Generate tokens
      const accessToken = jwtService.generateAccessToken({
        userId: user._id,
        username: user.username,
        email: user.email,
        isVerified: user.isVerified
      });

      const refreshPayload = {
        userId: user._id,
        deviceId: deviceInfo.deviceId,
        tokenId: crypto.randomBytes(16).toString('hex')
      };

      const refreshToken = jwtService.generateRefreshToken(refreshPayload);

      // Create session record
      const sessionData = {
        userId: user._id,
        deviceId: deviceInfo.deviceId,
        deviceInfo: {
          platform: deviceInfo.platform,
          deviceName: deviceInfo.deviceName || 'Unknown Device',
          appVersion: deviceInfo.appVersion || '1.0.0',
          osVersion: deviceInfo.osVersion || 'Unknown'
        },
        accessToken: hashToken(accessToken),
        refreshToken: hashToken(refreshToken),
        ipAddress: ipAddress,
        isActive: true,
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      };

      // Deactivate other sessions for this device
      await Session.updateMany(
        { 
          userId: user._id, 
          deviceId: deviceInfo.deviceId,
          isActive: true 
        },
        { 
          $set: { isActive: false } 
        }
      );

      // Create new session
      const session = await Session.create(sessionData);
      
      console.log(`✅ Session created for user ${user._id}, device: ${deviceInfo.deviceId}`);

      return {
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: 900 // 15 minutes
        },
        session: {
          deviceId: session.deviceId,
          expiresAt: session.expiresAt
        }
      };

    } catch (error) {
      console.error('Session creation error:', error.message);
      throw error;
    }
  }

  // Refresh access token
  async refreshAccessToken(refreshToken) {
    try {
      // Verify refresh token
      const decoded = jwtService.verifyRefreshToken(refreshToken);
      
      // Find active session (tokens are stored hashed)
      const session = await Session.findOne({
        userId: decoded.userId,
        deviceId: decoded.deviceId,
        refreshToken: hashToken(refreshToken),
        isActive: true,
        expiresAt: { $gt: new Date() }
      });

      if (!session) {
        throw new Error('Invalid or expired refresh token');
      }

      // Get user
      const user = await User.findById(decoded.userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Generate new tokens
      const newAccessToken = jwtService.generateAccessToken({
        userId: user._id,
        username: user.username,
        email: user.email,
        isVerified: user.isVerified
      });

      const newRefreshPayload = {
        userId: user._id,
        deviceId: decoded.deviceId,
        tokenId: crypto.randomBytes(16).toString('hex')
      };

      const newRefreshToken = jwtService.generateRefreshToken(newRefreshPayload);

      // Update session (tokens are stored hashed)
      session.accessToken = hashToken(newAccessToken);
      session.refreshToken = hashToken(newRefreshToken);
      session.lastActivity = new Date();
      await session.save();

      console.log(`🔄 Tokens refreshed for user ${user._id}`);

      return {
        success: true,
        tokens: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          tokenType: 'Bearer',
          expiresIn: 900 // 15 minutes
        }
      };

    } catch (error) {
      console.error('Token refresh error:', error.message);
      throw error;
    }
  }

  // Check username availability
  async checkUsernameAvailability(username) {
    try {
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return {
          success: false,
          available: false,
          error: 'Username must be 3-20 characters, alphanumeric and underscores only'
        };
      }

      const existingUser = await User.findOne({ 
        username: username.toLowerCase(),
        isActive: true 
      });

      return {
        success: true,
        available: !existingUser,
        username: username,
        message: existingUser ? 'Username is already taken' : 'Username is available'
      };

    } catch (error) {
      console.error('Username check error:', error.message);
      throw error;
    }
  }

  // Resend OTP
  async resendOTP(identifier, method, ipAddress) {
    try {
      // Check if user exists to determine purpose
      let existingUser;
      
      if (method === 'email') {
        existingUser = await User.findByAuthMethod('email', identifier);
      } else if (method === 'phone') {
        existingUser = await User.findByAuthMethod('phone', identifier);
      }

      const purpose = existingUser ? 'login' : 'signup';

      // Resend OTP
      const result = await customOTPService.resendOTP(
        identifier,
        method,
        purpose,
        existingUser?._id,
        ipAddress
      );

      return {
        success: true,
        method,
        identifier,
        purpose,
        message: `OTP resent to ${identifier}`
      };

    } catch (error) {
      console.error('Resend OTP error:', error.message);
      throw error;
    }
  }

  // Get current user
  async getCurrentUser(userId) {
    try {
      const user = await User.findById(userId).select('-passwordHash');
      
      if (!user) {
        throw new Error('User not found');
      }

      return {
        success: true,
        user: this.sanitizeUser(user)
      };

    } catch (error) {
      console.error('Get current user error:', error.message);
      throw error;
    }
  }

  // Logout user
  async logoutUser(userId, deviceId, accessToken = null) {
    try {
      // Deactivate session
      await Session.updateMany(
        { 
          userId: userId,
          deviceId: deviceId,
          isActive: true 
        },
        { 
          $set: { 
            isActive: false,
            updatedAt: new Date()
          } 
        }
      );

      // Revoke the access token immediately — otherwise it stays valid until
      // expiry even though the session is gone. TTL matches the max token life.
      if (accessToken) {
        try {
          await cacheService.set(`revoked_token:${hashToken(accessToken)}`, '1', 900);
        } catch (e) {
          console.warn('Token revocation cache write failed:', e.message);
        }
      }

      console.log(`👋 User ${userId} logged out from device: ${deviceId}`);

      return {
        success: true,
        message: 'Logged out successfully'
      };

    } catch (error) {
      console.error('Logout error:', error.message);
      throw error;
    }
  }

  // Sanitize user data for response
  sanitizeUser(user) {
    return {
      id: user._id,
      username: user.username,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      bio: user.bio,
      isVerified: user.isVerified,
      settings: user.settings,
      stats: user.stats,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }
}

module.exports = new AuthService();

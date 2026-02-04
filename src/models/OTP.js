const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  identifier: {
    type: String,
    required: true,
    trim: true
  },
  
  type: {
    type: String,
    enum: ['email', 'sms'],
    required: true
  },
  
  purpose: {
    type: String,
    enum: ['signup', 'login', 'password_reset', '2fa', 'verification'],
    required: true
  },
  
  hashedCode: {
    type: String,
    required: true
  },
  
  attempts: {
    type: Number,
    default: 0
  },
  
  maxAttempts: {
    type: Number,
    default: 3
  },
  
  verified: {
    type: Boolean,
    default: false
  },
  
  verifiedAt: {
    type: Date,
    default: null
  },
  
  ipAddress: {
    type: String,
    required: true
  },
  
  userAgent: {
    type: String,
    default: ''
  },
  
  // FIXED: Only one expiresAt definition
  expiresAt: {
    type: Date,
    required: true,
    expires: 0 // MongoDB TTL - auto-delete when expires
  }
}, {
  timestamps: true,
  collection: 'otps'
});

// FIXED: Only necessary indexes (no duplicates)
otpSchema.index({ identifier: 1, purpose: 1, verified: 1 });
otpSchema.index({ userId: 1 });
otpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 1800 }); // 30 minutes max lifetime

// Methods
otpSchema.methods.incrementAttempts = function() {
  this.attempts += 1;
  return this.save();
};

otpSchema.methods.markAsVerified = function() {
  this.verified = true;
  this.verifiedAt = new Date();
  return this.save();
};

otpSchema.methods.isExpired = function() {
  return this.expiresAt < new Date();
};

otpSchema.methods.isMaxAttemptsReached = function() {
  return this.attempts >= this.maxAttempts;
};

// Static methods
otpSchema.statics.findValidOTP = function(identifier, purpose) {
  return this.findOne({
    identifier,
    purpose,
    verified: false,
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
};

otpSchema.statics.cleanupExpired = function() {
  return this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
};

module.exports = mongoose.model('OTP', otpSchema);

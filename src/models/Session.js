const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  deviceId: {
    type: String,
    required: true
  },
  
  deviceInfo: {
    platform: {
      type: String,
      enum: ['ios', 'android', 'web', 'desktop'],
      required: true
    },
    deviceName: {
      type: String,
      default: 'Unknown Device'
    },
    appVersion: {
      type: String,
      default: '1.0.0'
    },
    osVersion: {
      type: String,
      default: 'Unknown'
    }
  },
  
  accessToken: {
    type: String,
    required: true,
    select: false
  },
  
  refreshToken: {
    type: String,
    required: true,
    select: false
  },
  
  firebaseToken: {
    type: String,
    default: null,
    select: false
  },
  
  ipAddress: {
    type: String,
    required: true
  },
  
  userAgent: {
    type: String,
    default: ''
  },
  
  location: {
    city: String,
    country: String,
    coordinates: {
      type: [Number],
      default: null
    }
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  lastActivity: {
    type: Date,
    default: Date.now
  },
  
  // FIXED: Only one expiresAt definition
  expiresAt: {
    type: Date,
    required: true,
    expires: 0 // MongoDB TTL
  }
}, {
  timestamps: true,
  collection: 'sessions'
});

// FIXED: Only necessary indexes (no duplicates)
sessionSchema.index({ userId: 1, isActive: 1 });
sessionSchema.index({ deviceId: 1 });
sessionSchema.index({ refreshToken: 1 });
sessionSchema.index({ lastActivity: -1 });

// Methods
sessionSchema.methods.updateActivity = function() {
  this.lastActivity = new Date();
  return this.save();
};

sessionSchema.methods.deactivate = function() {
  this.isActive = false;
  return this.save();
};

sessionSchema.methods.isExpired = function() {
  return this.expiresAt < new Date();
};

// Static methods
sessionSchema.statics.findActiveSession = function(userId, deviceId) {
  return this.findOne({
    userId,
    deviceId,
    isActive: true,
    expiresAt: { $gt: new Date() }
  });
};

sessionSchema.statics.deactivateUserSessions = function(userId, excludeDeviceId = null) {
  const query = { userId, isActive: true };
  if (excludeDeviceId) {
    query.deviceId = { $ne: excludeDeviceId };
  }
  
  return this.updateMany(query, { 
    $set: { isActive: false } 
  });
};

sessionSchema.statics.cleanupExpired = function() {
  return this.deleteMany({
    $or: [
      { expiresAt: { $lt: new Date() } },
      { isActive: false, updatedAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }
    ]
  });
};

module.exports = mongoose.model('Session', sessionSchema);

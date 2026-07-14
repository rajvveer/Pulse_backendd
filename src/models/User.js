const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // ===== AUTHENTICATION FIELDS (EXISTING) =====
  username: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 20,
    match: /^[a-zA-Z0-9_]+$/
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  email: {
    type: String,
    sparse: true,
    trim: true,
    lowercase: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  phone: {
    type: String,
    sparse: true,
    trim: true
  },
  passwordHash: {
    type: String,
    select: false
  },

  // ===== AUTH METHODS (EXISTING) =====
  authMethods: [{
    type: {
      type: String,
      enum: ['email', 'phone', 'google', 'facebook'],
      required: true
    },
    identifier: {
      type: String,
      required: true
    },
    verified: {
      type: Boolean,
      default: false
    },
    verifiedAt: {
      type: Date,
      default: null
    }
  }],

  // ===== PROFILE INFORMATION (NEW) =====
  profile: {
    displayName: {
      type: String,
      trim: true,
      maxlength: 50,
      default: ''
    },
    bio: {
      type: String,
      maxlength: 150,
      default: ''
    },
    avatar: {
      type: String,
      default: ''
    },
    coverPhoto: {
      type: String,
      default: 'https://res.cloudinary.com/pulse/image/upload/v1/defaults/cover.png'
    },
    website: {
      type: String,
      maxlength: 100,
      default: ''
    },
    location: {
      type: String,
      maxlength: 100,
      default: ''
    },
    dateOfBirth: {
      type: Date,
      default: null
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'non-binary', 'prefer-not-to-say', ''],
      default: ''
    }
  },

  // ===== ROLE =====
  role: {
    type: String,
    enum: ['user', 'admin', 'moderator'],
    default: 'user'
  },

  // ===== ACCOUNT STATUS (EXISTING + ENHANCED) =====
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  lastActive: {
    type: Date,
    default: Date.now
  },

  // ===== SOCIAL STATS (NEW) =====
  stats: {
    posts: {
      type: Number,
      default: 0
    },
    followers: {
      type: Number,
      default: 0
    },
    following: {
      type: Number,
      default: 0
    },
    likes: {
      type: Number,
      default: 0
    }
  },

  // ===== RELATIONSHIPS =====
  // DEPRECATED: followers[]/following[] are NO LONGER written. Follow state
  // lives in the dedicated, indexed `Follow` collection (O(1) follow/unfollow,
  // no 16MB document cap, no write contention on popular accounts). These
  // fields remain only so historical documents deserialize cleanly; do not
  // read or write them in new code — use the Follow model.
  followers: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    select: false // don't load these potentially-large arrays on every query
  },
  following: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    select: false
  },
  // blockedUsers is still used (Block has no dedicated collection yet). Kept
  // loadable; bounded in practice by how many users one person blocks.
  blockedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  // ===== LOCATION DATA (EXISTING - ENHANCED) =====
  lastLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0]
    },
    address: {
      type: String,
      default: ''
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },

  // ===== PRIVACY SETTINGS (NEW) =====
  privacy: {
    isPrivate: {
      type: Boolean,
      default: false
    },
    showEmail: {
      type: Boolean,
      default: false
    },
    showPhone: {
      type: Boolean,
      default: false
    },
    showLocation: {
      type: Boolean,
      default: true
    },
    showOnlineStatus: {
      type: Boolean,
      default: true
    },
    allowMessages: {
      type: String,
      enum: ['everyone', 'followers', 'none'],
      default: 'everyone'
    },
    allowTagging: {
      type: Boolean,
      default: true
    }
  },

  // ===== USER SETTINGS (EXISTING + ENHANCED) =====
  settings: {
    // Location settings
    radius: {
      type: Number,
      default: 1000, // meters
      min: 100,
      max: 50000
    },
    shareExactLocation: {
      type: Boolean,
      default: false
    },
    anonymousPosting: {
      type: Boolean,
      default: false
    },

    // Notification settings
    pushNotifications: {
      type: Boolean,
      default: true
    },
    emailNotifications: {
      type: Boolean,
      default: true
    },
    notifyOnFollow: {
      type: Boolean,
      default: true
    },
    notifyOnLike: {
      type: Boolean,
      default: true
    },
    notifyOnComment: {
      type: Boolean,
      default: true
    },
    notifyOnMention: {
      type: Boolean,
      default: true
    },

    // App settings
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'auto'
    },
    language: {
      type: String,
      default: 'en'
    }
  },

  // ===== SECURITY (EXISTING) =====
  twoFactorSecret: {
    type: String,
    select: false
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  lastLoginAt: {
    type: Date,
    default: null
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
  },

  // ===== VERIFICATION & BADGES (NEW) =====
  badges: [{
    type: {
      type: String,
      enum: ['verified', 'early-adopter', 'contributor', 'moderator'],
    },
    earnedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // ===== PUSH NOTIFICATION TOKENS =====
  fcmTokens: [{
    token: {
      type: String,
      required: true
    },
    deviceId: {
      type: String,
      required: true
    },
    platform: {
      type: String,
      enum: ['android', 'ios'],
      default: 'android'
    },
    lastUsed: {
      type: Date,
      default: Date.now
    }
  }],

  // ===== ACTIVITY TRACKING (NEW) =====
  lastPostAt: {
    type: Date,
    default: null
  },
  lastCommentAt: {
    type: Date,
    default: null
  },

  // ===== REFERRAL SYSTEM =====
  referralCode: {
    type: String,
    unique: true,
    sparse: true,
    uppercase: true,
    trim: true
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  referralCount: {
    type: Number,
    default: 0
  },

  // ===== ONBOARDING (cold-start taste seed) =====
  // Topics/vibes the user picked at signup, used to build their first
  // personalized feed before they have any engagement history.
  onboarding: {
    topics: [{ type: String }],
    vibes: [{ type: String }],
    completedAt: { type: Date, default: null }
  }

}, {
  timestamps: true,
  collection: 'users'
});

// ===== INDEXES =====
// Authentication indexes
userSchema.index({ username: 1 }, { unique: true, sparse: true });
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ phone: 1 }, { unique: true, sparse: true });
userSchema.index({ 'authMethods.type': 1, 'authMethods.identifier': 1 });

// Profile & search indexes
userSchema.index({ 'profile.displayName': 'text', username: 'text', 'profile.bio': 'text' });
userSchema.index({ isActive: 1, isVerified: 1 });
userSchema.index({ 'stats.followers': -1 }); // For trending users

// Location index
userSchema.index({ lastLocation: '2dsphere' });

// Activity indexes
userSchema.index({ lastActive: -1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ referralCode: 1 }, { unique: true, sparse: true });

// ===== VIRTUAL FIELDS =====
userSchema.virtual('followerCount').get(function () {
  // Source of truth is the maintained counter (Follow collection drives it).
  return this.stats?.followers || 0;
});

userSchema.virtual('followingCount').get(function () {
  return this.stats?.following || 0;
});

userSchema.virtual('age').get(function () {
  if (!this.profile.dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(this.profile.dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
});

// ===== INSTANCE METHODS (EXISTING) =====
userSchema.methods.isAccountLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

userSchema.methods.incrementLoginAttempts = function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 }
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  if (this.loginAttempts + 1 >= 5 && !this.isAccountLocked()) {
    updates.$set = { lockUntil: Date.now() + (2 * 60 * 60 * 1000) }; // 2 hours
  }

  return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 }
  });
};

// ===== NEW PROFILE METHODS =====
userSchema.methods.updateLastActive = function () {
  this.lastActive = new Date();
  return this.save();
};

userSchema.methods.setOnlineStatus = function (isOnline) {
  this.isOnline = isOnline;
  if (isOnline) {
    this.lastActive = new Date();
  }
  return this.save();
};

// NOTE: follow-relationship checks now live in the Follow collection. The
// async statics there (Follow.isFollowing) are the correct API. These instance
// helpers are kept only for any legacy caller and are guarded against the
// now-unselected arrays (which will be undefined on normal queries).
userSchema.methods.canViewProfile = function (viewerId) {
  if (!this.privacy?.isPrivate) return true;
  if (this._id.toString() === viewerId.toString()) return true;
  // Caller must verify follow via Follow.isFollowing; default to deny here.
  return Array.isArray(this.followers)
    ? this.followers.some(id => id.toString() === viewerId.toString())
    : false;
};

userSchema.methods.isFollowing = function (userId) {
  return Array.isArray(this.following)
    ? this.following.some(id => id.toString() === userId.toString())
    : false;
};

userSchema.methods.isFollower = function (userId) {
  return Array.isArray(this.followers)
    ? this.followers.some(id => id.toString() === userId.toString())
    : false;
};

userSchema.methods.isBlocked = function (userId) {
  return Array.isArray(this.blockedUsers)
    ? this.blockedUsers.some(id => id.toString() === userId.toString())
    : false;
};

// ===== STATIC METHODS (EXISTING + ENHANCED) =====
userSchema.statics.findByAuthMethod = function (type, identifier) {
  let query;

  if (type === 'email') {
    query = {
      $or: [
        { email: identifier },
        { 'authMethods.type': 'email', 'authMethods.identifier': identifier }
      ],
      isActive: true
    };
  } else if (type === 'phone') {
    const cleanPhone = identifier.replace(/\D/g, '');
    const formats = [
      identifier,
      cleanPhone,
      `+${cleanPhone}`,
      cleanPhone.startsWith('91') ? cleanPhone.substring(2) : `91${cleanPhone}`
    ];

    query = {
      $or: [
        { phone: { $in: formats } },
        { 'authMethods.type': 'phone', 'authMethods.identifier': { $in: formats } }
      ],
      isActive: true
    };
  } else {
    query = {
      'authMethods.type': type,
      'authMethods.identifier': identifier,
      isActive: true
    };
  }

  return this.findOne(query);
};

userSchema.statics.findByCredentials = function (identifier, password) {
  return this.findOne({
    $or: [
      { email: identifier },
      { username: identifier.toLowerCase() },
      { phone: identifier }
    ],
    isActive: true
  }).select('+passwordHash');
};

// ===== NEW STATIC METHODS FOR PROFILE =====
userSchema.statics.searchUsers = function (searchTerm, limit = 20) {
  // Escape user input — raw input in RegExp enables ReDoS
  const safeTerm = String(searchTerm).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return this.find({
    $or: [
      { username: new RegExp(safeTerm, 'i') },
      { 'profile.displayName': new RegExp(safeTerm, 'i') }
    ],
    isActive: true
  })
    .select('username profile.displayName profile.avatar profile.bio isVerified stats')
    .limit(limit);
};

userSchema.statics.getTrendingUsers = function (limit = 10) {
  return this.find({ isActive: true })
    .sort({ 'stats.followers': -1, lastActive: -1 })
    .select('username profile.displayName profile.avatar profile.bio isVerified stats')
    .limit(limit);
};

userSchema.statics.getSuggestedUsers = async function (userId, limit = 10) {
  // Exclude self and anyone the user already follows (resolved from the Follow
  // collection — the embedded `followers` array is deprecated/unselected).
  const Follow = mongoose.model('Follow');
  const followingIds = await Follow.getFollowingIds(userId);
  return this.find({
    _id: { $nin: [userId, ...followingIds] },
    isActive: true
  })
    .sort({ 'stats.followers': -1 })
    .select('username profile.displayName profile.avatar profile.bio isVerified stats')
    .limit(limit)
    .lean();
};

// ===== PRE-SAVE HOOKS =====
userSchema.pre('save', function (next) {
  // Follower/following counts are maintained from the Follow collection, NOT
  // from embedded array lengths (the arrays are deprecated & unselected).

  // Set displayName to username if not set
  if (!this.profile?.displayName && this.username) {
    this.profile.displayName = this.username;
  }

  next();
});

// ===== TRANSFORM OUTPUT (HIDE SENSITIVE FIELDS) =====
userSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret.passwordHash;
    delete ret.loginAttempts;
    delete ret.lockUntil;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);

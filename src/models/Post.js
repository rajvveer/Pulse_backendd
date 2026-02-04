const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  content: {
    text: {
      type: String,
      maxlength: 2000,
      trim: true
    },
    media: [{
      type: {
        type: String,
        enum: ['image', 'video', 'gif'],
        required: true
      },
      url: {
        type: String,
        required: true
      },
      thumbnail: String,
      width: Number,
      height: Number,
      duration: Number,
      size: Number
    }],
    hashtags: [{
      type: String,
      lowercase: true,
      trim: true
    }],
    mentions: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },

  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      index: '2dsphere'
    },
    address: String,
    placeName: String
  },

  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  stats: {
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    views: { type: Number, default: 0 }
  },

  visibility: {
    type: String,
    enum: ['public', 'followers', 'private'],
    default: 'public'
  },

  allowComments: {
    type: Boolean,
    default: true
  },

  isAnonymous: {
    type: Boolean,
    default: false
  },

  isActive: {
    type: Boolean,
    default: true
  },

  isEdited: {
    type: Boolean,
    default: false
  },

  editedAt: Date,

  isPinned: {
    type: Boolean,
    default: false
  },

  isReported: {
    type: Boolean,
    default: false
  },

  reportCount: {
    type: Number,
    default: 0
  },

  originalPost: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post'
  },

  isRepost: {
    type: Boolean,
    default: false
  },

  // VIBE/MOOD CLASSIFICATION
  vibe: {
    type: String,
    enum: ['chill', 'hype', 'sad', 'funny', 'creative', 'general'],
    default: 'general',
    index: true
  },
  vibeScore: {
    chill: { type: Number, default: 0 },
    hype: { type: Number, default: 0 },
    sad: { type: Number, default: 0 },
    funny: { type: Number, default: 0 },
    creative: { type: Number, default: 0 }
  }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ 'content.hashtags': 1 });
postSchema.index({ 'stats.likes': -1, createdAt: -1 });
postSchema.index({ location: '2dsphere' });
postSchema.index({ createdAt: -1 });

// Methods
postSchema.methods.isLikedBy = function (userId) {
  return this.likes.some(id => id.toString() === userId.toString());
};

// =========================================================
//  STATIC METHODS (FIXED POPULATE)
// =========================================================

postSchema.statics.getHomeFeed = function (userId, followingIds, options = {}) {
  const { limit = 20, lastPostDate } = options;

  const query = {
    isActive: true,
    author: { $in: [...followingIds, userId] },
    visibility: { $in: ['public', 'followers'] },
    createdAt: lastPostDate ? { $lt: new Date(lastPostDate) } : { $exists: true }
  };

  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    // ✅ FIX: Added 'profile'
    .populate('author', 'username name avatar profile isVerified')
    .lean();
};

postSchema.statics.getGlobalFeed = function (options = {}) {
  const { limit = 20, lastPostDate } = options;

  const query = {
    isActive: true,
    visibility: 'public',
    createdAt: lastPostDate ? { $lt: new Date(lastPostDate) } : { $exists: true }
  };

  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    // ✅ FIX: Added 'profile'
    .populate('author', 'username name avatar profile isVerified')
    .lean();
};

postSchema.statics.getTrendingPosts = function (options = {}) {
  const { limit = 20, timeRange = 24 } = options;
  const timeAgo = new Date(Date.now() - timeRange * 60 * 60 * 1000);

  return this.find({
    isActive: true,
    visibility: 'public',
    createdAt: { $gte: timeAgo }
  })
    .sort({ 'stats.likes': -1, 'stats.comments': -1 })
    .limit(limit)
    // ✅ FIX: Added 'profile'
    .populate('author', 'username name avatar profile isVerified')
    .lean();
};

postSchema.statics.getNearbyPosts = function (coordinates, maxDistance = 1000, options = {}) {
  const { limit = 20 } = options;

  return this.find({
    isActive: true,
    visibility: 'public',
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: coordinates
        },
        $maxDistance: maxDistance
      }
    }
  })
    .limit(limit)
    // ✅ FIX: Added 'profile'
    .populate('author', 'username name avatar profile isVerified')
    .lean();
};

// Pre-save hook
postSchema.pre('save', function (next) {
  if (this.isModified('likes')) {
    this.stats.likes = this.likes.length;
  }

  if (this.isModified('content.text') && this.content.text) {
    const hashtagRegex = /#[\w]+/g;
    const hashtags = this.content.text.match(hashtagRegex);
    if (hashtags) {
      this.content.hashtags = hashtags.map(tag => tag.substring(1).toLowerCase());
    }
  }

  next();
});

module.exports = mongoose.model('Post', postSchema);
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
  },

  // ── Semantic embedding for vector candidate retrieval ──
  // Fixed-dimension, L2-normalized feature vector (see embeddingService).
  // Powers "retrieve-then-rank": the feed retrieves posts whose embedding is
  // closest to the viewer's taste vector BEFORE the C++ ranker scores them.
  // On Atlas, create a vectorSearch index named by VECTOR_SEARCH_INDEX over
  // this path; otherwise an in-process cosine fallback is used.
  embedding: {
    type: [Number],
    default: undefined,
    select: false, // never ship the raw vector to clients
  },
  embeddingVersion: { type: Number, default: 0, select: false }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
postSchema.index({ author: 1, createdAt: -1 });
// Profile feed: posts by an author, active only, newest first.
postSchema.index({ author: 1, isActive: 1, createdAt: -1 });
// Dominant feed query: active + public, newest first. Covers the candidate-set
// scan in feedController so it never fetch-and-filters.
postSchema.index({ isActive: 1, visibility: 1, createdAt: -1 });
postSchema.index({ 'content.hashtags': 1 });
// Trending: recent window filtered by createdAt, then sorted by likes. Leading
// the index with createdAt lets the range filter use the index efficiently.
postSchema.index({ isActive: 1, visibility: 1, createdAt: -1, 'stats.likes': -1 });
postSchema.index({ location: '2dsphere' });
postSchema.index({ createdAt: -1 });
// Full-text search index — replaces the un-indexable case-insensitive $regex
// collection scans on content.text / hashtags.
postSchema.index(
  { 'content.text': 'text', 'content.hashtags': 'text' },
  { name: 'post_text_search', weights: { 'content.hashtags': 5, 'content.text': 1 } }
);

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

  // Compute the feature embedding when content changes (cheap, synchronous).
  // Lazy-require avoids a model↔service load cycle.
  if (this.isNew || this.isModified('content.text') || this.isModified('content.hashtags') || this.isModified('content.media') || this.isModified('vibe')) {
    try {
      const embeddingService = require('../services/embeddingService');
      this.embedding = embeddingService.featureVector(this);
      this.embeddingVersion = 1;
    } catch (e) {
      // Embedding is best-effort; retrieval degrades to recency if absent.
    }
  }

  next();
});

module.exports = mongoose.model('Post', postSchema);
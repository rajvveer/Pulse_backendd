const mongoose = require('mongoose');

const reelSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  videoUrl: {
    type: String,
    required: true
  },
  publicId: {
    type: String,
    required: true
  },
  caption: {
    type: String,
    maxlength: 2200
  },
  // Legacy - kept for migration compatibility, use Like collection instead
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  commentsCount: {
    type: Number,
    default: 0
  },
  // Stats for algorithm
  stats: {
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    saves: { type: Number, default: 0 },
    avgWatchPercentage: { type: Number, default: 0 }
  },
  // Content metadata
  duration: {
    type: Number, // seconds
    default: 0
  },
  hashtags: [{
    type: String,
    lowercase: true,
    trim: true
  }],
  music: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for algorithm queries
reelSchema.index({ user: 1, createdAt: -1 });
reelSchema.index({ createdAt: -1 });
reelSchema.index({ 'stats.likes': -1, createdAt: -1 });
reelSchema.index({ 'stats.views': -1 });
reelSchema.index({ hashtags: 1 });

module.exports = mongoose.model('Reel', reelSchema);
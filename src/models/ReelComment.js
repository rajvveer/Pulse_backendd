const mongoose = require('mongoose');

const reelCommentSchema = new mongoose.Schema({
  reel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Reel',
    required: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  // ✅ Supports Nesting (Replies)
  parentComment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ReelComment',
    default: null
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ✅ Virtual field to populate replies automatically
reelCommentSchema.virtual('replies', {
  ref: 'ReelComment',
  localField: '_id',
  foreignField: 'parentComment'
});

// Auto-populate author details when finding comments
reelCommentSchema.pre(/^find/, function(next) {
  this.populate({
    path: 'author',
    select: 'username avatar isVerified'
  });
  next();
});

module.exports = mongoose.model('ReelComment', reelCommentSchema);
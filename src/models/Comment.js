const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true,
    index: true
  },

  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  content: {
    type: String,
    required: true,
    maxlength: 500,
    trim: true,
    required:false
  },

  mentions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
    gif: {
    id: String,
    url: String,
    preview: String,
    width: Number,
    height: Number,
    description: String
  },

  parentComment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment',
    default: null
  },

  replies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment'
  }],

  isEdited: {
    type: Boolean,
    default: false
  },

  editedAt: Date,

  isActive: {
    type: Boolean,
    default: true
  }

}, {
  timestamps: true
});

// Indexes
commentSchema.index({ post: 1, createdAt: -1 });
commentSchema.index({ author: 1, createdAt: -1 });
commentSchema.index({ parentComment: 1 });

module.exports = mongoose.model('Comment', commentSchema);

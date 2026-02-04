const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'gif', 'sticker', 'system'],
    default: 'text'
  },
  content: {
    type: String,
    trim: true
  },
  media: {
    url: String,
    thumbnail: String,
    width: Number,
    height: Number,
    mimeType: String
  },
  // ✅ ADD THIS: Reply feature
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  // ✅ ADD THIS: Reactions
  reactions: {
    type: Map,
    of: String, // userId: emoji
    default: {}
  },
  readBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);

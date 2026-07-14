const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
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

// Chat history query is find({conversation}).sort({createdAt:-1}).limit(N).
// This compound index lets Mongo satisfy BOTH the equality match and the sort
// from the index — without it, busy group chats do an in-memory sort that
// aborts at the 32MB limit and pins CPU under load. Replaces the redundant
// single-field {conversation:1} index.
messageSchema.index({ conversation: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);

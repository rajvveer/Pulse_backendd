const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  // ✅ ADD: Type field to differentiate between DM and Group
  type: {
    type: String,
    enum: ['direct', 'group'],
    default: 'direct'
  },
  
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  
  // ✅ ADD: Group-specific fields
  groupName: {
    type: String,
    trim: true,
    maxlength: 100
  },
  
  groupAvatar: {
    type: String,
    default: null
  },
  
  groupDescription: {
    type: String,
    maxlength: 500
  },
  
  // ✅ ADD: Admin/Creator tracking
  admins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  
  lastMessageContent: { 
    type: String, 
    default: 'Started a conversation' 
  },
  
  lastMessageSender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  lastMessageAt: {
    type: Date,
    default: Date.now
  },
  
  // ✅ UPDATE: Unread counts per user
  unreadCounts: {
    type: Map,
    of: Number,
    default: {}
  }
}, { timestamps: true });

conversationSchema.index({ participants: 1 });
// Conversation list query: find({participants:userId}).sort({lastMessageAt:-1}).
// Compound index satisfies the match + sort from the index (no per-user
// in-memory sort).
conversationSchema.index({ participants: 1, lastMessageAt: -1 });
conversationSchema.index({ lastMessageAt: -1 });
conversationSchema.index({ type: 1 });

module.exports = mongoose.model('Conversation', conversationSchema);

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

// @desc    Get or Create a conversation with a user (DM only)
// @route   POST /api/v1/chat/conversation
exports.getOrCreateConversation = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const currentUserId = req.user.userId;

    if (!targetUserId) {
      return res.status(400).json({ success: false, message: 'Target user required' });
    }

    // 1. Try to find existing DM (type: direct with 2 participants)
    let conversation = await Conversation.findOne({
      type: 'direct',
      participants: { $all: [currentUserId, targetUserId], $size: 2 }
    }).populate('participants', 'username name avatar profile.avatar isVerified isOnline');

    // 2. Create if not exists
    if (!conversation) {
      conversation = await Conversation.create({
        type: 'direct',
        participants: [currentUserId, targetUserId],
        unreadCounts: { [currentUserId]: 0, [targetUserId]: 0 }
      });
      
      // Populate immediately
      conversation = await Conversation.findById(conversation._id)
        .populate('participants', 'username name avatar profile.avatar isVerified isOnline');
    }

    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error('❌ Create conversation error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all my conversations (DMs + Groups)
// @route   GET /api/v1/chat/conversations
exports.getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user.userId
    })
    .sort({ lastMessageAt: -1 })
    .populate('participants', 'username name avatar profile.avatar isVerified isOnline')
    .populate('admins', 'username name avatar profile.avatar')
    .populate('createdBy', 'username name avatar profile.avatar')
    .lean();

    res.json({ success: true, data: conversations });
  } catch (error) {
    console.error('❌ Get conversations error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get message history
// @route   GET /api/v1/chat/:conversationId/messages
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit = 50, before } = req.query;

    // Security: Ensure user is part of this conversation
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user.userId
    });

    if (!conversation) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const query = { 
      conversation: conversationId,
      isDeleted: { $ne: true } // Exclude deleted messages
    };
    
    // Pagination (Load older messages)
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 }) // Newest first
      .limit(parseInt(limit))
      .populate('sender', 'username name avatar profile.avatar isVerified')
      .populate({
        path: 'replyTo',
        select: 'content sender type media',
        populate: { path: 'sender', select: 'username name avatar profile.avatar' }
      })
      .lean();

    res.json({ success: true, data: messages });
  } catch (error) {
    console.error('❌ Get messages error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Mark conversation as read
// @route   POST /api/v1/chat/:conversationId/read
exports.markConversationRead = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.userId;

    // Reset the unread count specifically for this user to 0
    await Conversation.findByIdAndUpdate(conversationId, {
      $set: { [`unreadCounts.${userId}`]: 0 }
    });

    res.json({ success: true, message: 'Conversation marked as read' });
  } catch (error) {
    console.error('❌ Mark read error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a message
// @route   DELETE /api/v1/chat/messages/:messageId
exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    const message = await Message.findOne({
      _id: messageId,
      sender: userId
    });

    if (!message) {
      return res.status(404).json({ 
        success: false, 
        message: 'Message not found or unauthorized' 
      });
    }

    // Soft delete
    await Message.findByIdAndUpdate(messageId, {
      isDeleted: true,
      content: 'This message was deleted'
    });

    res.json({ success: true, message: 'Message deleted' });
  } catch (error) {
    console.error('❌ Delete message error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get conversation details (including group info)
// @route   GET /api/v1/chat/:conversationId
exports.getConversationDetails = async (req, res) => {
  try {
    const { conversationId } = req.params;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user.userId
    })
    .populate('participants', 'username name avatar profile.avatar isVerified isOnline')
    .populate('admins', 'username name avatar profile.avatar')
    .populate('createdBy', 'username name avatar profile.avatar');

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: 'Conversation not found' 
      });
    }

    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error('❌ Get conversation details error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Search conversations
// @route   GET /api/v1/chat/search
exports.searchConversations = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length === 0) {
      return res.json({ success: true, data: [] });
    }

    const conversations = await Conversation.find({
      participants: req.user.userId,
      $or: [
        { groupName: { $regex: q, $options: 'i' } },
        // Search in participants' usernames (requires aggregation for better performance)
      ]
    })
    .sort({ lastMessageAt: -1 })
    .limit(20)
    .populate('participants', 'username name avatar profile.avatar isVerified')
    .populate('admins', 'username')
    .lean();

    res.json({ success: true, data: conversations });
  } catch (error) {
    console.error('❌ Search conversations error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

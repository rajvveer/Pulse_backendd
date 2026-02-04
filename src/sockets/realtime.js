const Message = require('../models/Message');
const Conversation = require('../models/Conversation');

module.exports = (io, socket) => {
  
  // 1. Join Chat Room (SECURED) - ✅ FIXED: Handle both object and string
  socket.on('join_conversation', async (data) => {
    try {
      // ✅ Extract conversationId from object or string
      const conversationId = typeof data === 'string' ? data : data.conversationId;

      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: socket.userId
      });

      if (conversation) {
        socket.join(conversationId);
        console.log(`✅ User ${socket.userId} joined room ${conversationId}`);
      } else {
        console.warn(`⚠️ User ${socket.userId} attempted unauthorized access to ${conversationId}`);
        socket.emit('error', { message: "Unauthorized access to conversation" });
      }
    } catch (error) {
      console.error('❌ Join room error:', error);
    }
  });

  // 2. Leave Chat Room - ✅ FIXED: Handle both object and string
  socket.on('leave_conversation', (data) => {
    try {
      // ✅ Extract conversationId from object or string
      const conversationId = typeof data === 'string' ? data : data.conversationId;
      socket.leave(conversationId);
      console.log(`👋 User ${socket.userId} left room ${conversationId}`);
    } catch (error) {
      console.error('❌ Leave room error:', error);
    }
  });

  // 3. Send Message Event (WITH REPLY SUPPORT)
  socket.on('send_message', async (data, callback) => {
    try {
      const { conversationId, content, type = 'text', media, replyTo } = data;

      // A. Create Message with replyTo support
      const messageData = {
        conversation: conversationId,
        sender: socket.userId,
        content,
        type,
        media: media || undefined,
        replyTo: replyTo || undefined
      };

      let newMessage = await Message.create(messageData);

      // B. Populate Sender AND ReplyTo (Crucial for Frontend)
      newMessage = await Message.findById(newMessage._id)
        .populate('sender', 'username name avatar profile.avatar isVerified')
        .populate({
          path: 'replyTo',
          select: 'content sender type media',
          populate: { 
            path: 'sender', 
            select: 'username name avatar profile.avatar' 
          }
        });

      // C. Determine Preview Text
      let previewText = content;
      if (type === 'image') previewText = '📷 Photo';
      else if (type === 'gif') previewText = '🎬 GIF';
      else if (type === 'sticker') previewText = '😊 Sticker';
      else if (type === 'video') previewText = '🎥 Video';

      // D. Get Conversation & Calculate Unread Counts
      const conversation = await Conversation.findById(conversationId);
      
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      // Find all participants who are NOT the sender
      const otherParticipants = conversation.participants.filter(
        id => String(id) !== String(socket.userId)
      );

      const incUpdate = {};
      otherParticipants.forEach(userId => {
        incUpdate[`unreadCounts.${userId}`] = 1;
      });

      // E. Update Conversation
      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: newMessage._id,
        lastMessageContent: previewText,
        lastMessageAt: new Date(),
        lastMessageSender: socket.userId,
        $inc: incUpdate 
      });

      // F. Emit to ENTIRE Room (including sender for cross-device sync)
      io.to(conversationId).emit('new_message', newMessage);

      // G. Send Success Acknowledgment
      if (callback) {
        callback({ 
          status: "ok", 
          message: newMessage 
        });
      }

    } catch (error) {
      console.error('❌ Send message error:', error);
      if (callback) {
        callback({ 
          status: "error", 
          message: error.message 
        });
      }
    }
  });

  // 4. Mark Messages as Seen
  socket.on('mark_seen', async ({ conversationId, messageId }) => {
    try {
      // Reset unread count for this user
      await Conversation.findByIdAndUpdate(conversationId, {
        $set: { [`unreadCounts.${socket.userId}`]: 0 }
      });
      
      // Mark specific message as read (for blue checkmark)
      if (messageId) {
        await Message.findByIdAndUpdate(messageId, { 
          $addToSet: { readBy: socket.userId } 
        });
      }

      // Notify others in room
      socket.to(conversationId).emit('messages_seen', { 
        conversationId, 
        userId: socket.userId,
        messageIds: messageId ? [messageId] : []
      });

      console.log(`✅ User ${socket.userId} marked conversation ${conversationId} as seen`);
    } catch (error) {
      console.error('❌ Mark seen error:', error);
    }
  });

  // 5. Add Reaction to Message
  socket.on('add_reaction', async ({ conversationId, messageId, reaction }) => {
    try {
      // Update message with reaction
      await Message.findByIdAndUpdate(messageId, {
        $set: { [`reactions.${socket.userId}`]: reaction }
      });

      // Notify everyone in the room
      io.to(conversationId).emit('message_reaction', {
        messageId,
        userId: socket.userId,
        reaction
      });

      console.log(`✅ User ${socket.userId} reacted with ${reaction} to message ${messageId}`);
    } catch (error) {
      console.error('❌ Add reaction error:', error);
    }
  });

  // 6. Remove Reaction from Message
  socket.on('remove_reaction', async ({ conversationId, messageId }) => {
    try {
      await Message.findByIdAndUpdate(messageId, {
        $unset: { [`reactions.${socket.userId}`]: "" }
      });

      io.to(conversationId).emit('message_reaction', {
        messageId,
        userId: socket.userId,
        reaction: null
      });

      console.log(`✅ User ${socket.userId} removed reaction from message ${messageId}`);
    } catch (error) {
      console.error('❌ Remove reaction error:', error);
    }
  });

  // 7. Typing Indicators
  socket.on('typing_start', ({ conversationId }) => {
    socket.to(conversationId).emit('user_typing', { 
      userId: socket.userId, 
      isTyping: true 
    });
  });

  socket.on('typing_stop', ({ conversationId }) => {
    socket.to(conversationId).emit('user_typing', { 
      userId: socket.userId, 
      isTyping: false 
    });
  });

  // 8. Delete Message
  socket.on('delete_message', async ({ conversationId, messageId }, callback) => {
    try {
      const message = await Message.findOne({
        _id: messageId,
        sender: socket.userId // Only sender can delete
      });

      if (!message) {
        if (callback) callback({ status: 'error', message: 'Not authorized or message not found' });
        return;
      }

      // Soft delete
      await Message.findByIdAndUpdate(messageId, {
        isDeleted: true,
        content: 'This message was deleted'
      });

      // Notify everyone
      io.to(conversationId).emit('message_deleted', { messageId });

      if (callback) callback({ status: 'ok' });

      console.log(`✅ User ${socket.userId} deleted message ${messageId}`);
    } catch (error) {
      console.error('❌ Delete message error:', error);
      if (callback) callback({ status: 'error', message: error.message });
    }
  });

  // 9. User Goes Online (optional)
  socket.on('user_online', async () => {
    try {
      // Update user's online status in database if you have this field
      // await User.findByIdAndUpdate(socket.userId, { isOnline: true });
      
      // Broadcast to all user's conversations
      const conversations = await Conversation.find({
        participants: socket.userId
      }).select('_id');

      conversations.forEach(conv => {
        socket.to(conv._id.toString()).emit('user_status_change', {
          userId: socket.userId,
          isOnline: true
        });
      });
    } catch (error) {
      console.error('❌ User online error:', error);
    }
  });

  // 10. Disconnect Handler
  socket.on('disconnect', async () => {
    console.log(`❌ User ${socket.userId} disconnected`);
    
    try {
      // Broadcast offline status
      const conversations = await Conversation.find({
        participants: socket.userId
      }).select('_id');

      conversations.forEach(conv => {
        socket.to(conv._id.toString()).emit('user_status_change', {
          userId: socket.userId,
          isOnline: false
        });
      });
    } catch (error) {
      console.error('❌ Disconnect handler error:', error);
    }
  });
};

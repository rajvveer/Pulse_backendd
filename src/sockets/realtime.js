const Message = require('../models/Message');
const Conversation = require('../models/Conversation');

/**
 * Realtime chat handlers.
 *
 * IMPORTANT — cross-version compatibility:
 * Older app builds emit/listen for hyphenated event names ('send-message',
 * 'new-message', 'join-conversation', ...) while newer builds use underscored
 * names ('send_message', 'new_message', 'join_conversation', ...). Since we
 * cannot update an APK already installed on a user's phone, the server is the
 * only place both versions meet. So every handler is registered under ALL
 * known aliases, and every outgoing event is emitted under ALL aliases. This
 * lets an old client and a new client message each other reliably.
 */
module.exports = (io, socket) => {
  // Register one handler under several incoming event-name aliases.
  const onAny = (events, handler) => {
    events.forEach((event) => socket.on(event, handler));
  };

  // Emit to everyone in a room (including sender) under several aliases.
  const emitRoom = (room, events, payload) => {
    events.forEach((event) => io.to(room).emit(event, payload));
  };

  // Emit to everyone in a room EXCEPT the sender, under several aliases.
  const emitOthers = (room, events, payload) => {
    events.forEach((event) => socket.to(room).emit(event, payload));
  };

  // 1. Join Chat Room (SECURED) — accepts object or string payload
  const handleJoin = async (data) => {
    try {
      const conversationId = typeof data === 'string' ? data : data?.conversationId;
      if (!conversationId) return;

      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: socket.userId,
      });

      if (conversation) {
        socket.join(conversationId);
        console.log(`✅ User ${socket.userId} joined room ${conversationId}`);
      } else {
        console.warn(`⚠️ User ${socket.userId} attempted unauthorized access to ${conversationId}`);
        socket.emit('error', { message: 'Unauthorized access to conversation' });
      }
    } catch (error) {
      console.error('❌ Join room error:', error);
    }
  };
  onAny(['join_conversation', 'join-conversation'], handleJoin);

  // 2. Leave Chat Room — accepts object or string payload
  const handleLeave = (data) => {
    try {
      const conversationId = typeof data === 'string' ? data : data?.conversationId;
      if (!conversationId) return;
      socket.leave(conversationId);
      console.log(`👋 User ${socket.userId} left room ${conversationId}`);
    } catch (error) {
      console.error('❌ Leave room error:', error);
    }
  };
  onAny(['leave_conversation', 'leave-conversation'], handleLeave);

  // 3. Send Message (WITH REPLY SUPPORT)
  const handleSendMessage = async (data, callback) => {
    try {
      const { conversationId, content, type = 'text', media, replyTo } = data || {};

      // A. Create Message with replyTo support
      const messageData = {
        conversation: conversationId,
        sender: socket.userId,
        content,
        type,
        media: media || undefined,
        replyTo: replyTo || undefined,
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
            select: 'username name avatar profile.avatar',
          },
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
        (id) => String(id) !== String(socket.userId)
      );

      const incUpdate = {};
      otherParticipants.forEach((userId) => {
        incUpdate[`unreadCounts.${userId}`] = 1;
      });

      // E. Update Conversation
      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: newMessage._id,
        lastMessageContent: previewText,
        lastMessageAt: new Date(),
        lastMessageSender: socket.userId,
        $inc: incUpdate,
      });

      // F. Emit to ENTIRE Room (including sender for cross-device sync).
      //    Both event names so old + new clients all receive it.
      emitRoom(conversationId, ['new_message', 'new-message'], newMessage);

      // G. Send Success Acknowledgment
      if (callback) {
        callback({ status: 'ok', message: newMessage });
      }
    } catch (error) {
      console.error('❌ Send message error:', error);
      if (callback) {
        callback({ status: 'error', message: error.message });
      }
    }
  };
  onAny(['send_message', 'send-message'], handleSendMessage);

  // 4. Mark Messages as Seen
  const handleMarkSeen = async (data) => {
    try {
      const { conversationId, messageId } = data || {};
      if (!conversationId) return;

      // Reset unread count for this user
      await Conversation.findByIdAndUpdate(conversationId, {
        $set: { [`unreadCounts.${socket.userId}`]: 0 },
      });

      // Mark specific message as read (for blue checkmark)
      if (messageId) {
        await Message.findByIdAndUpdate(messageId, {
          $addToSet: { readBy: socket.userId },
        });
      }

      // Notify others in room
      emitOthers(conversationId, ['messages_seen', 'messages-seen', 'message-seen'], {
        conversationId,
        userId: socket.userId,
        messageIds: messageId ? [messageId] : [],
      });

      console.log(`✅ User ${socket.userId} marked conversation ${conversationId} as seen`);
    } catch (error) {
      console.error('❌ Mark seen error:', error);
    }
  };
  onAny(['mark_seen', 'mark-seen', 'message_seen', 'message-seen'], handleMarkSeen);

  // 5. Add Reaction to Message
  const handleAddReaction = async (data) => {
    try {
      const { conversationId, messageId, reaction } = data || {};
      if (!conversationId || !messageId) return;

      await Message.findByIdAndUpdate(messageId, {
        $set: { [`reactions.${socket.userId}`]: reaction },
      });

      emitRoom(conversationId, ['message_reaction', 'message-reaction'], {
        messageId,
        userId: socket.userId,
        reaction,
      });

      console.log(`✅ User ${socket.userId} reacted with ${reaction} to message ${messageId}`);
    } catch (error) {
      console.error('❌ Add reaction error:', error);
    }
  };
  onAny(['add_reaction', 'add-reaction'], handleAddReaction);

  // 6. Remove Reaction from Message
  const handleRemoveReaction = async (data) => {
    try {
      const { conversationId, messageId } = data || {};
      if (!conversationId || !messageId) return;

      await Message.findByIdAndUpdate(messageId, {
        $unset: { [`reactions.${socket.userId}`]: '' },
      });

      emitRoom(conversationId, ['message_reaction', 'message-reaction'], {
        messageId,
        userId: socket.userId,
        reaction: null,
      });

      console.log(`✅ User ${socket.userId} removed reaction from message ${messageId}`);
    } catch (error) {
      console.error('❌ Remove reaction error:', error);
    }
  };
  onAny(['remove_reaction', 'remove-reaction'], handleRemoveReaction);

  // 7. Typing Indicators
  const handleTypingStart = (data) => {
    const conversationId = typeof data === 'string' ? data : data?.conversationId;
    if (!conversationId) return;
    emitOthers(conversationId, ['user_typing', 'user-typing'], {
      userId: socket.userId,
      isTyping: true,
    });
  };
  onAny(['typing_start', 'typing-start', 'typing'], handleTypingStart);

  const handleTypingStop = (data) => {
    const conversationId = typeof data === 'string' ? data : data?.conversationId;
    if (!conversationId) return;
    emitOthers(conversationId, ['user_typing', 'user-typing'], {
      userId: socket.userId,
      isTyping: false,
    });
  };
  onAny(['typing_stop', 'typing-stop', 'stop_typing', 'stop-typing'], handleTypingStop);

  // 8. Delete Message
  const handleDeleteMessage = async (data, callback) => {
    try {
      const { conversationId, messageId } = data || {};

      const message = await Message.findOne({
        _id: messageId,
        sender: socket.userId, // Only sender can delete
      });

      if (!message) {
        if (callback) callback({ status: 'error', message: 'Not authorized or message not found' });
        return;
      }

      // Soft delete
      await Message.findByIdAndUpdate(messageId, {
        isDeleted: true,
        content: 'This message was deleted',
      });

      // Notify everyone
      emitRoom(conversationId, ['message_deleted', 'message-deleted'], { messageId });

      if (callback) callback({ status: 'ok' });

      console.log(`✅ User ${socket.userId} deleted message ${messageId}`);
    } catch (error) {
      console.error('❌ Delete message error:', error);
      if (callback) callback({ status: 'error', message: error.message });
    }
  };
  onAny(['delete_message', 'delete-message'], handleDeleteMessage);

  // 9. User Goes Online
  const handleUserOnline = async () => {
    try {
      const conversations = await Conversation.find({
        participants: socket.userId,
      }).select('_id');

      conversations.forEach((conv) => {
        emitOthers(conv._id.toString(), ['user_status_change', 'user-status-change'], {
          userId: socket.userId,
          isOnline: true,
        });
      });
    } catch (error) {
      console.error('❌ User online error:', error);
    }
  };
  onAny(['user_online', 'user-online'], handleUserOnline);

  // 10. Disconnect Handler
  socket.on('disconnect', async () => {
    console.log(`❌ User ${socket.userId} disconnected`);

    try {
      const conversations = await Conversation.find({
        participants: socket.userId,
      }).select('_id');

      conversations.forEach((conv) => {
        emitOthers(conv._id.toString(), ['user_status_change', 'user-status-change'], {
          userId: socket.userId,
          isOnline: false,
        });
      });
    } catch (error) {
      console.error('❌ Disconnect handler error:', error);
    }
  });
};

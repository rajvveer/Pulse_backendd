const mongoose = require('mongoose');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const presenceService = require('../services/presenceService');
const cacheService = require('../services/cacheService');
const { createSocketLimiter } = require('./socketRateLimit');

// Resolve a lightweight sender profile (incl. avatar) for message broadcasts.
// Cached in Redis (10 min) AND on the socket, so the send_message hot path
// does NOT re-read the author from Mongo on every message — but recipients
// still get the avatar/name the old populate provided. One cheap lookup per
// sender per cache window instead of one per message.
async function resolveSenderProfile(socket) {
  if (socket._senderProfile) return socket._senderProfile;
  const userId = socket.userId;
  const cacheKey = `chat_sender:${userId}`;
  let profile = null;
  try {
    profile = await cacheService.get(cacheKey);
  } catch { /* redis down */ }
  if (!profile) {
    const u = await User.findById(userId)
      .select('username name avatar profile.avatar isVerified')
      .lean()
      .catch(() => null);
    profile = u
      ? {
          _id: userId,
          username: u.username,
          name: u.name,
          avatar: u.avatar || u.profile?.avatar || null,
          profile: { avatar: u.profile?.avatar || u.avatar || null },
          isVerified: u.isVerified,
        }
      : { _id: userId };
    cacheService.set(cacheKey, profile, 600).catch(() => {});
  }
  socket._senderProfile = profile;
  return profile;
}

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
 *
 * SCALE NOTES (100K concurrent):
 *  - Presence (online/offline) is tracked in Redis, NOT MongoDB. Connect /
 *    disconnect no longer run a `Conversation.find()` per event.
 *  - Presence notifications fan out ONLY to the user's conversation peers, and
 *    only when they ACTUALLY transition online/offline (not on every tab).
 *  - send_message does ONE write + builds the broadcast payload in process
 *    instead of re-reading the message back with two populates.
 *  - Every handler is wrapped in a per-socket token-bucket rate limiter.
 */
module.exports = (io, socket) => {
  const limit = createSocketLimiter(socket);

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

  // Authorization guard: returns the conversation only if the socket user
  // is a participant. Every handler that mutates or broadcasts into a
  // conversation MUST go through this (clients control conversationId).
  const getAuthorizedConversation = async (conversationId) => {
    if (!conversationId || !mongoose.isValidObjectId(conversationId)) return null;
    return Conversation.findOne({
      _id: conversationId,
      participants: socket.userId,
    });
  };

  // 1. Join Chat Room (SECURED) — accepts object or string payload
  const handleJoin = async (data) => {
    try {
      const conversationId = typeof data === 'string' ? data : data?.conversationId;
      if (!conversationId) return;

      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: socket.userId,
      }).select('_id');

      if (conversation) {
        socket.join(conversationId);
      } else {
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
    } catch (error) {
      console.error('❌ Leave room error:', error);
    }
  };
  onAny(['leave_conversation', 'leave-conversation'], handleLeave);

  // 3. Send Message (WITH REPLY SUPPORT)
  const handleSendMessage = async (data, callback) => {
    if (!limit('message')) {
      if (callback) callback({ status: 'error', message: 'Rate limited' });
      return;
    }
    try {
      const { conversationId, content, type = 'text', media, replyTo } = data || {};

      // A0. Authorization — sender must be a participant of the conversation
      const conversation = await getAuthorizedConversation(conversationId);
      if (!conversation) {
        if (callback) callback({ status: 'error', message: 'Unauthorized access to conversation' });
        return;
      }

      // A. Create the message (ONE write).
      const newMessage = await Message.create({
        conversation: conversationId,
        sender: socket.userId,
        content,
        type,
        media: media || undefined,
        replyTo: replyTo || undefined,
      });

      // B. Build the broadcast payload IN PROCESS.
      //    Sender identity comes from a cached profile (Redis + socket-local),
      //    so we don't re-read the message + author from Mongo on every send.
      //    replyTo is only fetched when a reply was actually sent (rare).
      const sender = await resolveSenderProfile(socket);
      const payload = {
        _id: newMessage._id,
        conversation: conversationId,
        sender,
        content: newMessage.content,
        type: newMessage.type,
        media: newMessage.media,
        replyTo: undefined,
        reactions: {},
        readBy: [],
        isDeleted: false,
        createdAt: newMessage.createdAt,
        updatedAt: newMessage.updatedAt,
      };

      if (replyTo && mongoose.isValidObjectId(replyTo)) {
        payload.replyTo = await Message.findById(replyTo)
          .select('content sender type media')
          .populate('sender', 'username name avatar profile.avatar')
          .lean();
      }

      // C. Determine Preview Text
      let previewText = content;
      if (type === 'image') previewText = '📷 Photo';
      else if (type === 'gif') previewText = '🎬 GIF';
      else if (type === 'sticker') previewText = '😊 Sticker';
      else if (type === 'video') previewText = '🎥 Video';

      // D. Unread counts for everyone except the sender (conversation already
      //    loaded by the auth guard — no extra read).
      const incUpdate = {};
      conversation.participants
        .filter((id) => String(id) !== String(socket.userId))
        .forEach((userId) => {
          incUpdate[`unreadCounts.${userId}`] = 1;
        });

      // E. Update the conversation summary (fire-and-forget — the message is
      //    already persisted; the room broadcast must not wait on this).
      Conversation.updateOne(
        { _id: conversationId },
        {
          lastMessage: newMessage._id,
          lastMessageContent: previewText,
          lastMessageAt: new Date(),
          lastMessageSender: socket.userId,
          $inc: incUpdate,
        }
      ).catch((err) => console.error('❌ Conversation summary update failed:', err.message));

      // F. Broadcast to the room (including sender for cross-device sync),
      //    under both event-name aliases.
      emitRoom(conversationId, ['new_message', 'new-message'], payload);

      // G. Acknowledge.
      if (callback) callback({ status: 'ok', message: payload });
    } catch (error) {
      console.error('❌ Send message error:', error);
      if (callback) callback({ status: 'error', message: 'Failed to send message' });
    }
  };
  onAny(['send_message', 'send-message'], handleSendMessage);

  // 4. Mark Messages as Seen
  const handleMarkSeen = async (data) => {
    if (!limit('reaction')) return;
    try {
      const { conversationId, messageId } = data || {};
      if (!conversationId) return;

      // Authorization — only participants can mark a conversation as seen
      const conversation = await getAuthorizedConversation(conversationId);
      if (!conversation) return;

      await Conversation.updateOne(
        { _id: conversationId },
        { $set: { [`unreadCounts.${socket.userId}`]: 0 } }
      );

      // Mark specific message as read (scoped to this conversation so a
      // message ID from another chat cannot be targeted)
      if (messageId && mongoose.isValidObjectId(messageId)) {
        await Message.updateOne(
          { _id: messageId, conversation: conversationId },
          { $addToSet: { readBy: socket.userId } }
        );
      }

      emitOthers(conversationId, ['messages_seen', 'messages-seen', 'message-seen'], {
        conversationId,
        userId: socket.userId,
        messageIds: messageId ? [messageId] : [],
      });
    } catch (error) {
      console.error('❌ Mark seen error:', error);
    }
  };
  onAny(['mark_seen', 'mark-seen', 'message_seen', 'message-seen'], handleMarkSeen);

  // 5. Add Reaction to Message
  const handleAddReaction = async (data) => {
    if (!limit('reaction')) return;
    try {
      const { conversationId, messageId, reaction } = data || {};
      if (!conversationId || !messageId) return;

      const conversation = await getAuthorizedConversation(conversationId);
      if (!conversation) return;

      const updated = await Message.findOneAndUpdate(
        { _id: messageId, conversation: conversationId },
        { $set: { [`reactions.${socket.userId}`]: reaction } }
      );
      if (!updated) return;

      emitRoom(conversationId, ['message_reaction', 'message-reaction'], {
        messageId,
        userId: socket.userId,
        reaction,
      });
    } catch (error) {
      console.error('❌ Add reaction error:', error);
    }
  };
  onAny(['add_reaction', 'add-reaction'], handleAddReaction);

  // 6. Remove Reaction from Message
  const handleRemoveReaction = async (data) => {
    if (!limit('reaction')) return;
    try {
      const { conversationId, messageId } = data || {};
      if (!conversationId || !messageId) return;

      const conversation = await getAuthorizedConversation(conversationId);
      if (!conversation) return;

      const updated = await Message.findOneAndUpdate(
        { _id: messageId, conversation: conversationId },
        { $unset: { [`reactions.${socket.userId}`]: '' } }
      );
      if (!updated) return;

      emitRoom(conversationId, ['message_reaction', 'message-reaction'], {
        messageId,
        userId: socket.userId,
        reaction: null,
      });
    } catch (error) {
      console.error('❌ Remove reaction error:', error);
    }
  };
  onAny(['remove_reaction', 'remove-reaction'], handleRemoveReaction);

  // 7. Typing Indicators (no DB — pure in-room broadcast, heavily rate limited)
  const handleTypingStart = (data) => {
    if (!limit('typing')) return;
    const conversationId = typeof data === 'string' ? data : data?.conversationId;
    // Joining a room is membership-gated, so room presence implies authorization
    if (!conversationId || !socket.rooms.has(conversationId)) return;
    emitOthers(conversationId, ['user_typing', 'user-typing'], {
      userId: socket.userId,
      isTyping: true,
    });
  };
  onAny(['typing_start', 'typing-start', 'typing'], handleTypingStart);

  const handleTypingStop = (data) => {
    if (!limit('typing')) return;
    const conversationId = typeof data === 'string' ? data : data?.conversationId;
    if (!conversationId || !socket.rooms.has(conversationId)) return;
    emitOthers(conversationId, ['user_typing', 'user-typing'], {
      userId: socket.userId,
      isTyping: false,
    });
  };
  onAny(['typing_stop', 'typing-stop', 'stop_typing', 'stop-typing'], handleTypingStop);

  // 8. Delete Message
  const handleDeleteMessage = async (data, callback) => {
    if (!limit('message')) {
      if (callback) callback({ status: 'error', message: 'Rate limited' });
      return;
    }
    try {
      const { messageId } = data || {};
      if (!messageId || !mongoose.isValidObjectId(messageId)) {
        if (callback) callback({ status: 'error', message: 'Invalid message' });
        return;
      }

      // Only the sender can delete. Single atomic update; we read back only the
      // conversation id needed for the broadcast.
      const message = await Message.findOneAndUpdate(
        { _id: messageId, sender: socket.userId },
        { isDeleted: true, content: 'This message was deleted' },
        { new: false }
      ).select('conversation');

      if (!message) {
        if (callback) callback({ status: 'error', message: 'Not authorized or message not found' });
        return;
      }

      emitRoom(message.conversation.toString(), ['message_deleted', 'message-deleted'], { messageId });
      if (callback) callback({ status: 'ok' });
    } catch (error) {
      console.error('❌ Delete message error:', error);
      if (callback) callback({ status: 'error', message: 'Failed to delete message' });
    }
  };
  onAny(['delete_message', 'delete-message'], handleDeleteMessage);

  // 9. User Goes Online — Redis presence + notify ONLY conversation peers.
  //    We notify peers only on the first connection for this user (Redis says
  //    they just transitioned online), and the peer set is scoped to the user's
  //    conversations — never a global broadcast.
  const handleUserOnline = async () => {
    if (!limit('presence')) return;
    try {
      const justCameOnline = await presenceService.addConnection(socket.userId);
      if (!justCameOnline) return; // another tab/device was already online

      await notifyConversationPeers(true);
    } catch (error) {
      console.error('❌ User online error:', error);
    }
  };
  onAny(['user_online', 'user-online'], handleUserOnline);

  // Helper: tell the user's conversation peers about an online/offline change.
  // Scoped, capped fan-out — bounded by the number of conversations a single
  // user is in, not by total connected sockets.
  const notifyConversationPeers = async (isOnline) => {
    const conversations = await Conversation.find({ participants: socket.userId })
      .select('_id')
      .limit(500)
      .lean();
    conversations.forEach((conv) => {
      emitOthers(conv._id.toString(), ['user_status_change', 'user-status-change'], {
        userId: socket.userId,
        isOnline,
      });
    });
  };

  // 10. Disconnect — Redis DECR; only emit "offline" when the LAST socket for
  //     this user goes away. No DB write for the presence bookkeeping itself.
  socket.on('disconnect', async () => {
    try {
      const wentOffline = await presenceService.removeConnection(socket.userId);
      if (wentOffline) {
        await notifyConversationPeers(false);
      }
    } catch (error) {
      console.error('❌ Disconnect handler error:', error);
    }
  });
};

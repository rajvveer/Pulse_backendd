const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
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
        enum: ['like', 'comment', 'follow', 'chat', 'whisper', 'mention', 'reel_like', 'reel_comment'],
        required: true
    },
    // Reference to related content
    post: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post'
    },
    reel: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Reel'
    },
    whisper: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Whisper'
    },
    conversation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation'
    },
    comment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Comment'
    },
    // Custom message for display
    message: {
        type: String,
        maxlength: 200
    },
    isRead: {
        type: Boolean,
        default: false,
        index: true
    }
}, {
    timestamps: true,
    collection: 'notifications'
});

// Compound index for efficient queries
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1, createdAt: -1 });

// Static: Get notifications for a user with pagination
notificationSchema.statics.getNotifications = async function (userId, options = {}) {
    const { page = 1, limit = 20, type = null, unreadOnly = false } = options;

    const query = { recipient: userId };
    if (type) query.type = type;
    if (unreadOnly) query.isRead = false;

    const notifications = await this.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('sender', 'username profile.displayName profile.avatar isVerified')
        .populate('post', 'content.text content.media')
        .populate('reel', 'caption videoUrl')
        .lean();

    const total = await this.countDocuments(query);

    return {
        notifications,
        pagination: {
            page,
            limit,
            total,
            hasMore: page * limit < total
        }
    };
};

// Static: Get unread count
notificationSchema.statics.getUnreadCount = async function (userId) {
    return this.countDocuments({ recipient: userId, isRead: false });
};

// Static: Get unread count by type
notificationSchema.statics.getUnreadCountByType = async function (userId) {
    const result = await this.aggregate([
        { $match: { recipient: new mongoose.Types.ObjectId(userId), isRead: false } },
        { $group: { _id: '$type', count: { $sum: 1 } } }
    ]);

    const counts = { total: 0 };
    result.forEach(item => {
        counts[item._id] = item.count;
        counts.total += item.count;
    });

    return counts;
};

// Static: Mark as read
notificationSchema.statics.markAsRead = async function (notificationId, userId) {
    return this.findOneAndUpdate(
        { _id: notificationId, recipient: userId },
        { isRead: true },
        { new: true }
    );
};

// Static: Mark all as read
notificationSchema.statics.markAllAsRead = async function (userId, type = null) {
    const query = { recipient: userId, isRead: false };
    if (type) query.type = type;

    return this.updateMany(query, { isRead: true });
};

// Static: Create notification (prevent duplicate in short time)
notificationSchema.statics.createNotification = async function (data) {
    // Don't notify yourself
    if (data.sender.toString() === data.recipient.toString()) {
        return null;
    }

    // Check for recent duplicate (within 1 minute)
    const recentDuplicate = await this.findOne({
        recipient: data.recipient,
        sender: data.sender,
        type: data.type,
        post: data.post,
        reel: data.reel,
        createdAt: { $gte: new Date(Date.now() - 60000) }
    });

    if (recentDuplicate) {
        return recentDuplicate;
    }

    // Create the notification
    const notification = await this.create(data);

    // Send push notification asynchronously (don't wait for it)
    setImmediate(async () => {
        try {
            const pushService = require('../services/pushService');
            const User = require('./User');

            // Get sender info for notification message
            const sender = await User.findById(data.sender)
                .select('username profile.displayName')
                .lean();

            const senderName = sender?.profile?.displayName || sender?.username || 'Someone';

            // Generate notification content based on type
            let title = 'Pulse';
            let body = data.message || 'You have a new notification';
            let pushData = { type: data.type };

            switch (data.type) {
                case 'like':
                    title = '❤️ New Like';
                    body = `${senderName} liked your post`;
                    pushData.postId = data.post?.toString();
                    break;
                case 'reel_like':
                    title = '❤️ New Like';
                    body = `${senderName} liked your reel`;
                    pushData.reelId = data.reel?.toString();
                    break;
                case 'comment':
                    title = '💬 New Comment';
                    body = `${senderName} commented on your post`;
                    pushData.postId = data.post?.toString();
                    break;
                case 'reel_comment':
                    title = '💬 New Comment';
                    body = `${senderName} commented on your reel`;
                    pushData.reelId = data.reel?.toString();
                    break;
                case 'follow':
                    title = '👤 New Follower';
                    body = `${senderName} started following you`;
                    pushData.username = sender?.username;
                    break;
                case 'chat':
                    title = '💬 New Message';
                    body = `${senderName} sent you a message`;
                    pushData.conversationId = data.conversation?.toString();
                    break;
                case 'whisper':
                    title = '🤫 New Whisper';
                    body = `Someone sent you a whisper`;
                    pushData.whisperId = data.whisper?.toString();
                    break;
                case 'mention':
                    title = '📢 You were mentioned';
                    body = `${senderName} mentioned you`;
                    pushData.postId = data.post?.toString();
                    break;
            }

            // Send push notification
            await pushService.sendToUser(data.recipient.toString(), { title, body }, pushData);
        } catch (error) {
            console.error('Push notification error (non-blocking):', error.message);
        }
    });

    return notification;
};

// Static: Delete old notifications (cleanup job)
notificationSchema.statics.deleteOldNotifications = async function (daysOld = 30) {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    return this.deleteMany({ createdAt: { $lt: cutoffDate }, isRead: true });
};

module.exports = mongoose.model('Notification', notificationSchema);

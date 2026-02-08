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

    return this.create(data);
};

// Static: Delete old notifications (cleanup job)
notificationSchema.statics.deleteOldNotifications = async function (daysOld = 30) {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    return this.deleteMany({ createdAt: { $lt: cutoffDate }, isRead: true });
};

module.exports = mongoose.model('Notification', notificationSchema);

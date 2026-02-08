const Notification = require('../models/Notification');

// Get notifications for current user
exports.getNotifications = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { page = 1, limit = 20, type, unreadOnly } = req.query;

        const result = await Notification.getNotifications(userId, {
            page: parseInt(page),
            limit: parseInt(limit),
            type: type || null,
            unreadOnly: unreadOnly === 'true'
        });

        res.status(200).json({
            success: true,
            data: result.notifications,
            pagination: result.pagination
        });
    } catch (error) {
        console.error('Get Notifications Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
    }
};

// Get unread count
exports.getUnreadCount = async (req, res) => {
    try {
        const userId = req.user.userId;
        const counts = await Notification.getUnreadCountByType(userId);

        res.status(200).json({
            success: true,
            data: counts
        });
    } catch (error) {
        console.error('Get Unread Count Error:', error);
        res.status(500).json({ success: false, message: 'Failed to get unread count' });
    }
};

// Mark single notification as read
exports.markAsRead = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;

        const notification = await Notification.markAsRead(id, userId);

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.status(200).json({
            success: true,
            data: notification
        });
    } catch (error) {
        console.error('Mark As Read Error:', error);
        res.status(500).json({ success: false, message: 'Failed to mark notification as read' });
    }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { type } = req.query;

        await Notification.markAllAsRead(userId, type || null);

        res.status(200).json({
            success: true,
            message: 'All notifications marked as read'
        });
    } catch (error) {
        console.error('Mark All As Read Error:', error);
        res.status(500).json({ success: false, message: 'Failed to mark notifications as read' });
    }
};

// Delete notification
exports.deleteNotification = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;

        const result = await Notification.findOneAndDelete({ _id: id, recipient: userId });

        if (!result) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.status(200).json({
            success: true,
            message: 'Notification deleted'
        });
    } catch (error) {
        console.error('Delete Notification Error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete notification' });
    }
};

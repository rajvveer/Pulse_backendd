const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken } = require('../middlewares/auth');

// All routes require authentication
router.use(authenticateToken);

// GET /api/v1/notifications - Get all notifications (with optional filters)
router.get('/', notificationController.getNotifications);

// GET /api/v1/notifications/count - Get unread count by type
router.get('/count', notificationController.getUnreadCount);

// PATCH /api/v1/notifications/read-all - Mark all as read
router.patch('/read-all', notificationController.markAllAsRead);

// PATCH /api/v1/notifications/:id/read - Mark single as read
router.patch('/:id/read', notificationController.markAsRead);

// DELETE /api/v1/notifications/:id - Delete notification
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;

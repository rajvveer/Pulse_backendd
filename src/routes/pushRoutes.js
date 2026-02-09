const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const pushService = require('../services/pushService');

// All routes require authentication
router.use(verifyAccessToken);

/**
 * POST /api/v1/push/register
 * Register FCM token for push notifications
 */
router.post('/register', async (req, res) => {
    try {
        const userId = req.user.userId;
        const { token, deviceId, platform } = req.body;

        if (!token || !deviceId) {
            return res.status(400).json({
                success: false,
                message: 'Token and deviceId are required'
            });
        }

        const result = await pushService.registerToken(
            userId,
            token,
            deviceId,
            platform || 'android'
        );

        if (result.success) {
            res.status(200).json({
                success: true,
                message: 'Push notification token registered'
            });
        } else {
            res.status(500).json({
                success: false,
                message: result.error || 'Failed to register token'
            });
        }
    } catch (error) {
        console.error('Register push token error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to register push notification token'
        });
    }
});

/**
 * DELETE /api/v1/push/unregister
 * Unregister FCM token (on logout)
 */
router.delete('/unregister', async (req, res) => {
    try {
        const userId = req.user.userId;
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                message: 'deviceId is required'
            });
        }

        const result = await pushService.unregisterToken(userId, deviceId);

        res.status(200).json({
            success: true,
            message: 'Push notification token unregistered'
        });
    } catch (error) {
        console.error('Unregister push token error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to unregister push notification token'
        });
    }
});

/**
 * GET /api/v1/push/status
 * Check if push notifications are enabled
 */
router.get('/status', async (req, res) => {
    try {
        const User = require('../models/User');
        const userId = req.user.userId;

        const user = await User.findById(userId).select('fcmTokens settings.pushNotifications');

        res.status(200).json({
            success: true,
            data: {
                enabled: user?.settings?.pushNotifications !== false,
                registeredDevices: user?.fcmTokens?.length || 0,
                firebaseConfigured: pushService.isFirebaseReady()
            }
        });
    } catch (error) {
        console.error('Get push status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get push notification status'
        });
    }
});

module.exports = router;

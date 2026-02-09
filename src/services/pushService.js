/**
 * Firebase Admin SDK Push Notification Service
 * Handles sending push notifications via FCM
 */
const admin = require('firebase-admin');
const config = require('../config');

let firebaseInitialized = false;

/**
 * Initialize Firebase Admin SDK
 */
const initializeFirebase = () => {
    if (firebaseInitialized) return;

    try {
        // Check for service account credentials
        const serviceAccountPath = config.get('firebase.serviceAccountPath');
        const projectId = config.get('firebase.projectId');

        if (serviceAccountPath) {
            // Initialize with service account file
            const serviceAccount = require(serviceAccountPath);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId: projectId || serviceAccount.project_id
            });
            console.log('✅ Firebase Admin initialized with service account');
        } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            // Initialize with environment variables
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
                }),
                projectId: process.env.FIREBASE_PROJECT_ID
            });
            console.log('✅ Firebase Admin initialized with environment variables');
        } else {
            console.warn('⚠️ Firebase not configured - push notifications disabled');
            return;
        }

        firebaseInitialized = true;
    } catch (error) {
        console.error('❌ Firebase initialization error:', error.message);
    }
};

/**
 * Check if Firebase is configured and ready
 */
const isFirebaseReady = () => {
    return firebaseInitialized;
};

/**
 * Send push notification to a specific FCM token
 * @param {string} token - FCM token
 * @param {Object} notification - { title, body, imageUrl }
 * @param {Object} data - Additional data payload
 * @returns {Promise<Object>}
 */
const sendToToken = async (token, notification, data = {}) => {
    if (!firebaseInitialized) {
        console.warn('⚠️ Firebase not initialized, skipping push');
        return null;
    }

    try {
        const message = {
            token,
            notification: {
                title: notification.title,
                body: notification.body,
                ...(notification.imageUrl && { imageUrl: notification.imageUrl })
            },
            data: {
                ...data,
                // Ensure all data values are strings
                click_action: 'FLUTTER_NOTIFICATION_CLICK'
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'pulse_notifications',
                    priority: 'high',
                    sound: 'default'
                }
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: 1
                    }
                }
            }
        };

        const response = await admin.messaging().send(message);
        console.log('✅ Push notification sent:', response);
        return { success: true, messageId: response };
    } catch (error) {
        console.error('❌ Push notification error:', error.message);

        // If token is invalid, we should remove it
        if (error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered') {
            return { success: false, invalidToken: true, error: error.message };
        }

        return { success: false, error: error.message };
    }
};

/**
 * Send push notification to a user (all their devices)
 * @param {string} userId - User's MongoDB ID
 * @param {Object} notification - { title, body, imageUrl }
 * @param {Object} data - Additional data payload
 * @returns {Promise<Object>}
 */
const sendToUser = async (userId, notification, data = {}) => {
    if (!firebaseInitialized) {
        return { success: false, reason: 'Firebase not initialized' };
    }

    try {
        const User = require('../models/User');
        const user = await User.findById(userId).select('fcmTokens settings.pushNotifications');

        if (!user) {
            return { success: false, reason: 'User not found' };
        }

        // Check if user has push notifications enabled
        if (user.settings && user.settings.pushNotifications === false) {
            return { success: false, reason: 'User disabled push notifications' };
        }

        // Get valid tokens
        const tokens = user.fcmTokens || [];
        if (tokens.length === 0) {
            return { success: false, reason: 'No FCM tokens registered' };
        }

        // Send to all user's devices
        const results = await Promise.all(
            tokens.map(async (tokenData) => {
                const result = await sendToToken(tokenData.token, notification, data);
                return {
                    token: tokenData.token,
                    deviceId: tokenData.deviceId,
                    ...result
                };
            })
        );

        // Remove invalid tokens
        const invalidTokens = results.filter(r => r.invalidToken).map(r => r.token);
        if (invalidTokens.length > 0) {
            await User.findByIdAndUpdate(userId, {
                $pull: { fcmTokens: { token: { $in: invalidTokens } } }
            });
            console.log(`🗑️ Removed ${invalidTokens.length} invalid FCM tokens for user ${userId}`);
        }

        const successCount = results.filter(r => r.success).length;
        return {
            success: successCount > 0,
            sent: successCount,
            failed: results.length - successCount,
            results
        };
    } catch (error) {
        console.error('❌ Send to user error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Register FCM token for a user
 * @param {string} userId - User's MongoDB ID
 * @param {string} token - FCM token
 * @param {string} deviceId - Device identifier
 * @param {string} platform - 'android' or 'ios'
 */
const registerToken = async (userId, token, deviceId, platform) => {
    try {
        const User = require('../models/User');

        // Remove this token from any other user (token transfer on login)
        await User.updateMany(
            { _id: { $ne: userId }, 'fcmTokens.token': token },
            { $pull: { fcmTokens: { token } } }
        );

        // Add or update token for current user
        await User.findByIdAndUpdate(
            userId,
            {
                $pull: { fcmTokens: { deviceId } } // Remove old token for this device
            }
        );

        await User.findByIdAndUpdate(
            userId,
            {
                $push: {
                    fcmTokens: {
                        token,
                        deviceId,
                        platform,
                        lastUsed: new Date()
                    }
                }
            }
        );

        console.log(`✅ FCM token registered for user ${userId}`);
        return { success: true };
    } catch (error) {
        console.error('❌ Register token error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Unregister FCM token (on logout)
 * @param {string} userId - User's MongoDB ID
 * @param {string} deviceId - Device identifier
 */
const unregisterToken = async (userId, deviceId) => {
    try {
        const User = require('../models/User');

        await User.findByIdAndUpdate(userId, {
            $pull: { fcmTokens: { deviceId } }
        });

        console.log(`✅ FCM token unregistered for user ${userId}`);
        return { success: true };
    } catch (error) {
        console.error('❌ Unregister token error:', error);
        return { success: false, error: error.message };
    }
};

// Initialize on module load
initializeFirebase();

module.exports = {
    initializeFirebase,
    isFirebaseReady,
    sendToToken,
    sendToUser,
    registerToken,
    unregisterToken
};

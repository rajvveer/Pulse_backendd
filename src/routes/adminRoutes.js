const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const pulseDropController = require('../controllers/pulseDropController');
const auth = require('../middlewares/auth');
const { authLimiter } = require('../middlewares/rateLimit');

// Public: admin login (rate-limited like other auth endpoints)
router.post('/login', authLimiter, adminController.login);

// Everything below requires a valid token AND the admin role
router.use(auth.verifyAccessToken.bind(auth), auth.requireAdmin.bind(auth));

// Dashboard
router.get('/stats', adminController.getStats);

// Users
router.get('/users', adminController.listUsers);
router.patch('/users/:userId/status', adminController.updateUserStatus);
router.patch('/users/:userId/role', adminController.updateUserRole);

// Posts
router.get('/posts', adminController.listPosts);
router.patch('/posts/:postId/status', adminController.updatePostStatus);

// Reels
router.get('/reels', adminController.listReels);
router.delete('/reels/:reelId', adminController.deleteReel);

// Pulse Drops
router.get('/drops', adminController.listDrops);
router.post('/drops', pulseDropController.createDrop);
router.patch('/drops/:dropId/expire', adminController.expireDrop);

module.exports = router;

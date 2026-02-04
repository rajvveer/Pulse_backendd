const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const userController = require('../controllers/userController');
const upload = require('../middlewares/upload');

// ✅ ADD THIS - Must be FIRST to avoid route conflicts
router.get('/search', verifyAccessToken, userController.searchUsers);

// Get current user profile
router.get('/me', verifyAccessToken, userController.getCurrentUser);

// Get user profile by username
router.get('/:username', verifyAccessToken, userController.getUserByUsername);

// NEW: Get user posts
router.get('/:username/posts', verifyAccessToken, userController.getUserPosts);

// Update user profile
router.patch('/me', verifyAccessToken, userController.updateProfile);

// Upload avatar
router.post('/me/avatar', verifyAccessToken, upload.single('avatar'), userController.uploadAvatar);

// Follow/Unfollow user
router.post('/:username/follow', verifyAccessToken, userController.toggleFollow);

// Get lists
router.get('/:username/followers', verifyAccessToken, userController.getFollowers);
router.get('/:username/following', verifyAccessToken, userController.getFollowing);

module.exports = router;

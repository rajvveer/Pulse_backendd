const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const userController = require('../controllers/userController');
const upload = require('../middlewares/upload');
const { uploadLimiter } = require('../middlewares/rateLimit');

// ✅ ADD THIS - Must be FIRST to avoid route conflicts
router.get('/search', verifyAccessToken, userController.searchUsers);

// Onboarding (cold-start interest picker → immediate personalized feed)
router.get('/onboarding/options', verifyAccessToken, userController.getOnboardingOptions);
router.post('/onboarding', verifyAccessToken, userController.submitOnboarding);

// Get current user profile
router.get('/me', verifyAccessToken, userController.getCurrentUser);

// Account management — keep these BEFORE the /:username routes so the
// literal "me" / "me/..." paths aren't swallowed by the param matcher.
router.patch('/me/password', verifyAccessToken, userController.changePassword);
router.delete('/me', verifyAccessToken, userController.deleteAccount);
router.get('/me/blocked', verifyAccessToken, userController.getBlockedUsers);

// Get user profile by username
router.get('/:username', verifyAccessToken, userController.getUserByUsername);

// NEW: Get user posts
router.get('/:username/posts', verifyAccessToken, userController.getUserPosts);

// Update user profile
router.patch('/me', verifyAccessToken, userController.updateProfile);

// Upload avatar
router.post('/me/avatar', verifyAccessToken, uploadLimiter, upload.uploadGuard, upload.single('avatar'), userController.uploadAvatar);

// Follow/Unfollow user
router.post('/:username/follow', verifyAccessToken, userController.toggleFollow);

// Block/Unblock user
router.post('/:username/block', verifyAccessToken, userController.blockUser);
router.delete('/:username/block', verifyAccessToken, userController.unblockUser);

// Get lists
router.get('/:username/followers', verifyAccessToken, userController.getFollowers);
router.get('/:username/following', verifyAccessToken, userController.getFollowing);

module.exports = router;

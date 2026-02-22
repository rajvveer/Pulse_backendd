const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const bookmarkController = require('../controllers/bookmarkController');

// All routes require authentication
router.use(verifyAccessToken);

// Toggle bookmark
router.post('/', bookmarkController.toggleBookmark);

// Get bookmarks (query: ?type=post|reel)
router.get('/', bookmarkController.getBookmarks);

// Check if item is bookmarked
router.get('/check/:itemId', bookmarkController.checkBookmark);

module.exports = router;

const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const upload = require('../middlewares/upload');
const reelController = require('../controllers/reelController');

// 1. Create Reel
router.post('/create', verifyAccessToken, upload.single('file'), reelController.createReel);

// 2. Get Feed (supports ?type=foryou|following)
router.get('/feed', verifyAccessToken, reelController.getReelsFeed);

// 3. Like/Unlike Reel
router.post('/:reelId/like', verifyAccessToken, reelController.toggleLike);

// 4. Track View/Watch Time (for algorithm)
router.post('/:reelId/view', verifyAccessToken, reelController.trackView);

// 5. Share Reel (tracks for algorithm)
router.post('/:reelId/share', verifyAccessToken, reelController.shareReel);

// 6. Add Comment (Supports replies via body.parentCommentId)
router.post('/:reelId/comments', verifyAccessToken, reelController.addComment);

// 7. Get Comments (supports ?sort=best|top|new|controversial)
router.get('/:reelId/comments', verifyAccessToken, reelController.getComments);

// 8. Like/Unlike Comment
router.post('/:reelId/comments/:commentId/like', verifyAccessToken, reelController.toggleCommentLike);

module.exports = router;
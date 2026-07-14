const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const upload = require('../middlewares/upload');
const { uploadLimiter } = require('../middlewares/rateLimit');
const snapController = require('../controllers/snapController');

// Create a snap (story or direct). Photo or short video — capacity-guarded.
// The default multer instance accepts images and short videos (mp4/mov/webp),
// which covers snaps; reelGuard enforces the in-flight byte budget + size cap.
router.post(
  '/',
  verifyAccessToken,
  uploadLimiter,
  upload.reelGuard,
  upload.single('file'),
  snapController.createSnap
);

// Story rail (own + followed authors' active stories, grouped by author).
router.get('/rail', verifyAccessToken, snapController.getStoryRail);

// Direct snap inbox (disappearing snaps sent to me).
router.get('/direct', verifyAccessToken, snapController.getDirectInbox);

// Mark viewed / react / viewers / delete.
router.post('/:snapId/view', verifyAccessToken, snapController.viewSnap);
router.post('/:snapId/react', verifyAccessToken, snapController.reactSnap);
router.get('/:snapId/viewers', verifyAccessToken, snapController.getViewers);
router.delete('/:snapId', verifyAccessToken, snapController.deleteSnap);

module.exports = router;

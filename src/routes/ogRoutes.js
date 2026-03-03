const express = require('express');
const router = express.Router();
const ogController = require('../controllers/ogController');

// Public routes — no auth required (crawlers & social media bots need access)
router.get('/post/:postId', ogController.sharePost);
router.get('/profile/:username', ogController.shareProfile);
router.get('/reel/:reelId', ogController.shareReel);

module.exports = router;

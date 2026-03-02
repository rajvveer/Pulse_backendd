const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const feedController = require('../controllers/feedController');

// For You - personalized discovery feed
router.get('/foryou', verifyAccessToken, feedController.getForYouFeed);

// Following feed - chronological posts from followed users
router.get('/following', verifyAccessToken, feedController.getFollowingFeed);

// Global feed - all public posts with light ranking
router.get('/global', verifyAccessToken, feedController.getGlobalFeed);

// Home feed - following + own posts
router.get('/home', verifyAccessToken, feedController.getHomeFeed);

// Trending posts - velocity-based
router.get('/trending', verifyAccessToken, feedController.getTrendingPosts);

// Nearby posts - location-based
router.get('/nearby', verifyAccessToken, feedController.getNearbyPosts);

module.exports = router;
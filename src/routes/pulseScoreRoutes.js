const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const pulseScoreController = require('../controllers/pulseScoreController');

// All routes require authentication
router.use(auth.verifyAccessToken);

// My score
router.get('/me', pulseScoreController.getMyScore);

// My detailed breakdown
router.get('/breakdown', pulseScoreController.getBreakdown);

// My achievements
router.get('/achievements', pulseScoreController.getAchievements);

// Score history (for charts)
router.get('/history', pulseScoreController.getHistory);

// Leaderboard
router.get('/leaderboard', pulseScoreController.getLeaderboard);

// Another user's score
router.get('/user/:userId', pulseScoreController.getUserScore);

module.exports = router;

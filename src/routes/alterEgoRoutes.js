const express = require('express');
const router = express.Router();
const alterEgoController = require('../controllers/alterEgoController');
const { verifyAccessToken } = require('../middlewares/auth');

// All routes require auth
router.use(verifyAccessToken);

// Get my alter ego
router.get('/me', alterEgoController.getMyEgo);

// Get stats
router.get('/stats', alterEgoController.getStats);

// Update settings
router.put('/', alterEgoController.update);

// Update training
router.post('/train', alterEgoController.train);

// Toggle active
router.post('/toggle', alterEgoController.toggle);

// Test response generation
router.post('/generate', alterEgoController.generateResponse);

// Learn from user
router.post('/learn', alterEgoController.learn);

// === ALTER EGO 2.0 ROUTES ===
// Activity log
router.get('/activity', alterEgoController.getActivityLog);

// Guess-who game
router.post('/guess', alterEgoController.recordGuess);

// AI provider status
router.get('/ai-status', alterEgoController.getAIStatus);

module.exports = router;

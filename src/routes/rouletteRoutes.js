const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const rouletteController = require('../controllers/rouletteController');

// All routes require authentication
router.use(auth.verifyAccessToken);

// Join roulette queue
router.post('/join', rouletteController.joinQueue);

// Check current session status (polling)
router.get('/status', rouletteController.checkStatus);

// Send message in chat
router.post('/message', rouletteController.sendMessage);

// Make decision (connect/pass)
router.post('/decide', rouletteController.decide);

// Leave queue
router.post('/leave', rouletteController.leave);

// Match history
router.get('/history', rouletteController.getHistory);

module.exports = router;

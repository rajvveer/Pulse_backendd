const express = require('express');
const router = express.Router();
const whisperController = require('../controllers/whisperController');
const { verifyAccessToken } = require('../middlewares/auth');

// All routes require auth
router.use(verifyAccessToken);

// Get nearby whispers
router.get('/nearby', whisperController.getNearby);

// Create whisper
router.post('/', whisperController.create);

// Vote on whisper
router.post('/:whisperId/vote', whisperController.vote);

// Reply to whisper
router.post('/:whisperId/reply', whisperController.reply);

// Report whisper
router.post('/:whisperId/report', whisperController.report);

module.exports = router;

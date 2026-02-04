const express = require('express');
const router = express.Router();
const pulseDropController = require('../controllers/pulseDropController');
const { verifyAccessToken } = require('../middlewares/auth');

// All routes require auth
router.use(verifyAccessToken);

// Get active drops
router.get('/', pulseDropController.getActive);

// Get single drop
router.get('/:dropId', pulseDropController.getById);

// Join a drop
router.post('/:dropId/join', pulseDropController.join);

// Create response for a drop
router.post('/:dropId/respond', pulseDropController.createResponse);

// Get drop responses
router.get('/:dropId/responses', pulseDropController.getResponses);

// Admin: Create drop manually
router.post('/create', pulseDropController.createDrop);

module.exports = router;

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const socialDNAController = require('../controllers/socialDNAController');

// All routes require authentication
router.use(auth.verifyAccessToken);

// My DNA profile
router.get('/me', socialDNAController.getMyDNA);

// Share card data
router.get('/share-card', socialDNAController.getShareCard);

// Record a share (viral tracking)
router.post('/share', socialDNAController.recordShare);

// Weekly evolution (snapshots)
router.get('/evolution', socialDNAController.getEvolution);

// Find my DNA twins
router.get('/twins', socialDNAController.findTwins);

// Compatibility with another user
router.get('/match/:targetUserId', socialDNAController.getCompatibility);

// View another user's public DNA
router.get('/user/:userId', socialDNAController.getUserDNA);

module.exports = router;

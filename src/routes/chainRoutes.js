const express = require('express');
const router = express.Router();
const chainController = require('../controllers/chainController');
const { verifyAccessToken } = require('../middlewares/auth');

// All routes require auth
router.use(verifyAccessToken);

// Get chains
router.get('/', chainController.getChains);

// Get single chain
router.get('/:chainId', chainController.getById);

// Create chain
router.post('/', chainController.create);

// Submit segment
router.post('/:chainId/segment', chainController.submitSegment);

// Get pending segments
router.get('/:chainId/pending', chainController.getPending);

// Vote on segment
router.post('/:chainId/segment/:segmentId/vote', chainController.voteSegment);

// Like chain
router.post('/:chainId/like', chainController.likeChain);

module.exports = router;

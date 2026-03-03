const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const { verifyAccessToken } = require('../middlewares/auth');

// All referral routes require authentication
router.use(verifyAccessToken);

// Get (or generate) the logged-in user's referral code
router.get('/my-code', referralController.getMyCode);

// Apply someone else's referral code
router.post('/apply', referralController.applyCode);

// Get referral stats (count + recent referrals)
router.get('/stats', referralController.getStats);

module.exports = router;

const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const gifController = require('../controllers/gifController');

// All routes require authentication
router.use(verifyAccessToken);

// Search GIFs
router.get('/search', gifController.searchGifs);

// Get trending GIFs
router.get('/trending', gifController.getTrendingGifs);

// Get categories
router.get('/categories', gifController.getCategories);

module.exports = router;

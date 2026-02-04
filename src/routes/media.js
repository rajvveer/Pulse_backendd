const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const upload = require('../middlewares/upload');
const mediaController = require('../controllers/mediaController');

// Upload single image
router.post('/upload', verifyAccessToken, upload.single('file'), mediaController.uploadMedia);

// Upload multiple images
router.post('/upload-multiple', verifyAccessToken, upload.array('files', 10), mediaController.uploadMultipleMedia);

module.exports = router;

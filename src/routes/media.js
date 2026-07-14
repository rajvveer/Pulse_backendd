const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const upload = require('../middlewares/upload');
const { uploadLimiter } = require('../middlewares/rateLimit');
const mediaController = require('../controllers/mediaController');

// Upload single image. uploadGuard rejects oversized / over-capacity requests
// (by Content-Length) BEFORE buffering any bytes into memory.
router.post('/upload', verifyAccessToken, uploadLimiter, upload.uploadGuard, upload.single('file'), mediaController.uploadMedia);

// Upload multiple images
router.post('/upload-multiple', verifyAccessToken, uploadLimiter, upload.uploadGuard, upload.array('files', 5), mediaController.uploadMultipleMedia);

module.exports = router;

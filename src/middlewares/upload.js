const multer = require('multer');
const path = require('path');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only images and videos allowed'));
  }
};

const upload = multer({
  storage: storage,
  // 🚀 100MB limit — generous for reels/videos, safe for memory under load
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: fileFilter
});

module.exports = upload;
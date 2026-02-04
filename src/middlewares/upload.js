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
  // 🚀 UPDATED: Increased limit to 500MB
  limits: { fileSize: 500 * 1024 * 1024 }, 
  fileFilter: fileFilter
});

module.exports = upload;
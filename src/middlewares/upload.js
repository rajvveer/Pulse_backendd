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

// Per-file size cap. Files are buffered in memory before streaming to
// Cloudinary, so this directly bounds per-request RAM. Lowered from 100MB —
// at 100MB × 10 files a single /upload-multiple could buffer ~1GB and OOM-kill
// the container (taking all its sockets with it). 25MB images / short clips is
// plenty; large videos should use a signed direct-to-Cloudinary upload.
const MAX_FILE_MB = parseInt(process.env.UPLOAD_MAX_MB) || 25;
const MAX_FILES = parseInt(process.env.UPLOAD_MAX_FILES) || 5;

const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_MB * 1024 * 1024,
    files: MAX_FILES
  },
  fileFilter: fileFilter
});

// ── Per-process in-flight upload-bytes semaphore ──
//
// multer's per-file limit bounds ONE request; it does nothing about many large
// uploads landing at once. A few dozen concurrent multi-file uploads can still
// blow the container memory limit. This guard caps the TOTAL bytes being
// buffered for upload across the whole process at any instant, using the
// request's declared Content-Length, and rejects early (413) when over budget
// — before a single byte is read into memory.
const MAX_INFLIGHT_MB = parseInt(process.env.UPLOAD_MAX_INFLIGHT_MB) || 256;
const MAX_INFLIGHT_BYTES = MAX_INFLIGHT_MB * 1024 * 1024;
// Hard ceiling on a single request body (Content-Length) regardless of file
// count — defends against a lying/over-large multipart body.
const MAX_REQUEST_BYTES = (MAX_FILE_MB * MAX_FILES + 2) * 1024 * 1024;

let inflightBytes = 0;

// Factory: build an upload guard with a specific per-request ceiling (MB).
// Images use the default; reels (video) pass a larger cap. All variants share
// the SAME process-wide in-flight byte budget so total memory stays bounded.
function makeUploadGuard(maxRequestMb) {
  const maxRequestBytes = (maxRequestMb || (MAX_FILE_MB * MAX_FILES + 2)) * 1024 * 1024;
  return function uploadGuard(req, res, next) {
    const declared = parseInt(req.headers['content-length']) || 0;

    if (declared > maxRequestBytes) {
      return res.status(413).json({
        success: false,
        error: 'Upload too large.',
        code: 'PAYLOAD_TOO_LARGE'
      });
    }

    if (declared > 0 && inflightBytes + declared > MAX_INFLIGHT_BYTES) {
      // Shed load rather than risk OOM. Client should retry shortly.
      return res.status(503).json({
        success: false,
        error: 'Server is busy handling uploads. Please retry in a moment.',
        code: 'UPLOAD_CAPACITY'
      });
    }

    inflightBytes += declared;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inflightBytes = Math.max(0, inflightBytes - declared);
    };
    // Release the reservation when the request finishes, errors, or the client
    // hangs up — whichever comes first.
    res.on('finish', release);
    res.on('close', release);
    req.on('aborted', release);

    next();
  };
}

// Dedicated video uploader for reels — higher per-file cap, single file.
const REEL_MAX_MB = parseInt(process.env.REEL_MAX_MB) || 80;
const videoUpload = multer({
  storage,
  limits: { fileSize: REEL_MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /mp4|mov|webm|quicktime/.test(file.mimetype) || /mp4|mov|webm/.test(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only video files allowed'), ok);
  }
});

module.exports = upload;
module.exports.videoUpload = videoUpload;
module.exports.makeUploadGuard = makeUploadGuard;
module.exports.uploadGuard = makeUploadGuard();              // default (images)
module.exports.reelGuard = makeUploadGuard(REEL_MAX_MB + 2); // video
module.exports.limits = { MAX_FILE_MB, MAX_FILES, MAX_INFLIGHT_MB, REEL_MAX_MB };

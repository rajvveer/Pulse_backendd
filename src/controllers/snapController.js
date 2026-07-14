const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const mongoose = require('mongoose');
const Snap = require('../models/Snap');
const Follow = require('../models/Follow');
const config = require('../config');

cloudinary.config({
  cloud_name: config.get('media.cloudinary.cloudName'),
  api_key: config.get('media.cloudinary.apiKey'),
  api_secret: config.get('media.cloudinary.apiSecret'),
});

// Max viewers kept inline on a story doc (avoids unbounded growth on a viral
// snap). The denormalized viewCount is always accurate.
const MAX_VIEWERS = 500;

/**
 * @desc   Create a snap (story or direct). Multipart: file + fields.
 * @route  POST /api/v1/snaps
 */
exports.createSnap = async (req, res) => {
  const userId = req.user.userId;
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No media provided' });
  }

  const audience = req.body.audience === 'direct' ? 'direct' : 'story';
  let recipients = [];
  if (audience === 'direct') {
    try {
      recipients = JSON.parse(req.body.recipients || '[]')
        .filter((id) => mongoose.isValidObjectId(id));
    } catch {
      recipients = [];
    }
    if (recipients.length === 0) {
      return res.status(400).json({ success: false, message: 'Direct snaps need recipients' });
    }
  }

  const isVideo = (req.file.mimetype || '').startsWith('video');

  try {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `${config.get('media.cloudinary.folder')}/snaps`,
        resource_type: isVideo ? 'video' : 'image',
        transformation: isVideo
          ? [{ width: 720, crop: 'limit', quality: 'auto:good' }]
          : [{ width: 1080, crop: 'limit', quality: 'auto:good' }],
      },
      async (error, result) => {
        if (error) {
          console.error('Snap upload error:', error.message);
          return res.status(500).json({ success: false, message: 'Upload failed' });
        }

        try {
          const snap = await Snap.create({
            user: userId,
            audience,
            recipients,
            mediaType: isVideo ? 'video' : 'image',
            mediaUrl: result.secure_url,
            publicId: result.public_id,
            thumbnailUrl: isVideo
              ? result.secure_url.replace(/\.(mp4|mov|webm)$/i, '.jpg')
              : result.secure_url,
            durationMs: Math.min(Math.max(parseInt(req.body.durationMs) || 5000, 1000), 15000),
            caption: (req.body.caption || '').slice(0, 280),
            expiresAt: Snap.defaultExpiry(),
          });

          res.status(201).json({ success: true, data: snap });
        } catch (dbErr) {
          console.error('Snap save error:', dbErr.message);
          res.status(500).json({ success: false, message: 'Could not save snap' });
        }
      }
    );

    Readable.from(req.file.buffer).pipe(uploadStream);
  } catch (err) {
    console.error('Create snap error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * @desc   Story rail — own + followed authors' active stories, grouped.
 * @route  GET /api/v1/snaps/rail
 */
exports.getStoryRail = async (req, res) => {
  try {
    const userId = req.user.userId;
    const followingIds = await Follow.getFollowingIds(userId);
    const rings = await Snap.getStoryRail(userId, followingIds);
    res.json({ success: true, data: rings });
  } catch (err) {
    console.error('Story rail error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load stories' });
  }
};

/**
 * @desc   Direct snap inbox (disappearing snaps sent to me).
 * @route  GET /api/v1/snaps/direct
 */
exports.getDirectInbox = async (req, res) => {
  try {
    const snaps = await Snap.getDirectInbox(req.user.userId);
    res.json({ success: true, data: snaps });
  } catch (err) {
    console.error('Direct inbox error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load snaps' });
  }
};

/**
 * @desc   Mark a snap viewed by the current user (idempotent).
 * @route  POST /api/v1/snaps/:snapId/view
 */
exports.viewSnap = async (req, res) => {
  try {
    const { snapId } = req.params;
    const userId = req.user.userId;
    if (!mongoose.isValidObjectId(snapId)) {
      return res.status(400).json({ success: false, message: 'Invalid snap' });
    }

    const snap = await Snap.findById(snapId).select('audience user recipients viewers viewCount');
    if (!snap) return res.status(404).json({ success: false, message: 'Snap not found' });

    // Authorization: direct snaps only viewable by sender/recipients.
    if (snap.audience === 'direct') {
      const allowed =
        String(snap.user) === String(userId) ||
        snap.recipients.some((r) => String(r) === String(userId));
      if (!allowed) return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const already = (snap.viewers || []).some((v) => String(v.user) === String(userId));
    if (!already && String(snap.user) !== String(userId)) {
      // Atomic add — $addToSet on the viewer ref + $inc, capped via $slice.
      await Snap.updateOne(
        { _id: snapId },
        {
          $push: { viewers: { $each: [{ user: userId, viewedAt: new Date() }], $slice: -MAX_VIEWERS } },
          $inc: { viewCount: 1 },
        }
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('View snap error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * @desc   React to a snap with a short emoji/token.
 * @route  POST /api/v1/snaps/:snapId/react   body: { reaction }
 */
exports.reactSnap = async (req, res) => {
  try {
    const { snapId } = req.params;
    const reaction = String(req.body.reaction || '').slice(0, 8);
    const userId = req.user.userId;
    if (!mongoose.isValidObjectId(snapId)) {
      return res.status(400).json({ success: false, message: 'Invalid snap' });
    }

    const update = reaction
      ? { $set: { [`reactions.${userId}`]: reaction } }
      : { $unset: { [`reactions.${userId}`]: '' } };
    const snap = await Snap.findByIdAndUpdate(snapId, update, { new: true }).select('reactions');
    if (!snap) return res.status(404).json({ success: false, message: 'Snap not found' });

    res.json({ success: true, data: { reaction } });
  } catch (err) {
    console.error('React snap error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * @desc   Viewers list for a snap (only the author may see it).
 * @route  GET /api/v1/snaps/:snapId/viewers
 */
exports.getViewers = async (req, res) => {
  try {
    const { snapId } = req.params;
    const snap = await Snap.findById(snapId)
      .select('user viewCount viewers')
      .populate('viewers.user', 'username name avatar profile.avatar isVerified');
    if (!snap) return res.status(404).json({ success: false, message: 'Snap not found' });
    if (String(snap.user) !== String(req.user.userId)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    res.json({
      success: true,
      data: { viewCount: snap.viewCount, viewers: snap.viewers.map((v) => v.user).filter(Boolean) },
    });
  } catch (err) {
    console.error('Get viewers error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * @desc   Delete own snap.
 * @route  DELETE /api/v1/snaps/:snapId
 */
exports.deleteSnap = async (req, res) => {
  try {
    const { snapId } = req.params;
    const snap = await Snap.findOne({ _id: snapId, user: req.user.userId });
    if (!snap) return res.status(404).json({ success: false, message: 'Snap not found' });

    if (snap.publicId) {
      cloudinary.uploader
        .destroy(snap.publicId, { resource_type: snap.mediaType === 'video' ? 'video' : 'image' })
        .catch(() => {});
    }
    await snap.deleteOne();
    res.json({ success: true, message: 'Snap deleted' });
  } catch (err) {
    console.error('Delete snap error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

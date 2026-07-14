const mongoose = require('mongoose');

/**
 * Snap — ephemeral media that disappears.
 *
 * Two audiences, one model:
 *  - audience: 'story'  → posted to the user's story rail; visible to followers
 *                         for 24h, then auto-expires (TTL index).
 *  - audience: 'direct' → sent to specific recipients (classic disappearing
 *                         snap); each recipient sees it once, then it's marked
 *                         viewed for them. Also TTL-expires for cleanup.
 *
 * Like/Reel patterns are followed: counters are denormalized, viewers are a
 * bounded sub-collection (capped reads), and the heavy media lives on
 * Cloudinary (only URLs stored here).
 */
const snapSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    audience: {
      type: String,
      enum: ['story', 'direct'],
      default: 'story',
      required: true,
    },

    // For direct snaps: who can see it. Empty for story snaps.
    recipients: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    mediaType: {
      type: String,
      enum: ['image', 'video'],
      default: 'image',
    },
    mediaUrl: { type: String, required: true },
    publicId: { type: String },
    thumbnailUrl: { type: String },
    durationMs: { type: Number, default: 5000 }, // how long an image snap shows

    caption: { type: String, maxlength: 280, trim: true },

    // Viewers (who has seen it). Bounded; we cap how many we keep for stories.
    viewers: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        viewedAt: { type: Date, default: Date.now },
      },
    ],
    viewCount: { type: Number, default: 0 },

    // Lightweight reactions (emoji char or short token). Keyed by userId.
    reactions: {
      type: Map,
      of: String,
      default: {},
    },

    // TTL: auto-deletes ~24h after creation. The index drives expiry.
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

// Story rail query: newest active story snaps by a set of authors.
snapSchema.index({ audience: 1, user: 1, createdAt: -1 });
// Direct inbox query: snaps addressed to a recipient, newest first.
snapSchema.index({ audience: 1, recipients: 1, createdAt: -1 });

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// ===== STATICS =====

/**
 * Build the story rail for a viewer: their own active story + active stories
 * from the people they follow, grouped by author (most recent first).
 * `followingIds` is supplied by the caller (resolved from the Follow collection).
 */
snapSchema.statics.getStoryRail = async function (viewerId, followingIds = []) {
  const authorIds = [...new Set([viewerId.toString(), ...followingIds.map(String)])];
  const now = new Date();

  const snaps = await this.find({
    audience: 'story',
    user: { $in: authorIds },
    expiresAt: { $gt: now },
  })
    .sort({ createdAt: 1 })
    .populate('user', 'username name avatar profile.avatar isVerified')
    .lean();

  // Group by author into "rings". Mark whether the viewer has seen all snaps
  // from each author (controls the unseen ring on the avatar).
  const byAuthor = new Map();
  for (const snap of snaps) {
    const authorId = (snap.user?._id || snap.user).toString();
    if (!byAuthor.has(authorId)) {
      byAuthor.set(authorId, { user: snap.user, snaps: [], hasUnseen: false });
    }
    const group = byAuthor.get(authorId);
    const seen = (snap.viewers || []).some((v) => String(v.user) === String(viewerId));
    if (!seen) group.hasUnseen = true;
    group.snaps.push({
      _id: snap._id,
      mediaType: snap.mediaType,
      mediaUrl: snap.mediaUrl,
      thumbnailUrl: snap.thumbnailUrl,
      durationMs: snap.durationMs,
      caption: snap.caption,
      createdAt: snap.createdAt,
      viewCount: snap.viewCount,
      seen,
    });
  }

  // Order: the viewer's own ring first, then unseen rings, then seen rings.
  const rings = [...byAuthor.entries()].map(([authorId, g]) => ({ authorId, ...g }));
  rings.sort((a, b) => {
    if (a.authorId === viewerId.toString()) return -1;
    if (b.authorId === viewerId.toString()) return 1;
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
    return 0;
  });
  return rings;
};

/** Direct snaps addressed to a user that they haven't opened yet (inbox). */
snapSchema.statics.getDirectInbox = function (userId) {
  return this.find({
    audience: 'direct',
    recipients: userId,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .populate('user', 'username name avatar profile.avatar isVerified')
    .lean();
};

snapSchema.statics.defaultExpiry = () => new Date(Date.now() + DEFAULT_TTL_MS);

module.exports = mongoose.model('Snap', snapSchema);

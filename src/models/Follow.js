const mongoose = require('mongoose');

/**
 * Follow Model — Dedicated collection for follow relationships.
 * 
 * This replaces storing followers/following as arrays inside the User document,
 * which doesn't scale past ~10K followers due to MongoDB's 16MB document limit
 * and the cost of rewriting the entire array on every follow/unfollow.
 * 
 * With this model:
 * - Follow/unfollow is O(1) — just insert/delete a single document
 * - Follower count is O(1) via countDocuments with index
 * - No document size limits
 * - Can add metadata (followedAt, source, etc.)
 */
const followSchema = new mongoose.Schema({
  // The user who is following
  follower: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // The user being followed
  following: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  }
}, {
  timestamps: true
});

// Compound unique index — prevents duplicate follows
followSchema.index({ follower: 1, following: 1 }, { unique: true });

// Index for efficient "get followers of X" queries
followSchema.index({ following: 1, createdAt: -1 });

// Index for efficient "get who X follows" queries
followSchema.index({ follower: 1, createdAt: -1 });

// ===== STATIC METHODS =====

/**
 * Toggle follow relationship. Returns { followed, followerCount, followingCount }
 */
followSchema.statics.toggleFollow = async function (followerId, followingId) {
  // Delete-first toggle: atomic check-and-remove, so concurrent requests
  // can't double-create (the unique index would make that a 500).
  const deleted = await this.deleteOne({ follower: followerId, following: followingId });

  if (deleted.deletedCount > 0) {
    const followerCount = await this.countDocuments({ following: followingId });
    const followingCount = await this.countDocuments({ follower: followerId });
    return { followed: false, followerCount, followingCount };
  }

  try {
    await this.create({ follower: followerId, following: followingId });
  } catch (err) {
    // Duplicate from a concurrent follow — already in the desired state
    if (err.code !== 11000) throw err;
  }
  const followerCount = await this.countDocuments({ following: followingId });
  const followingCount = await this.countDocuments({ follower: followerId });
  return { followed: true, followerCount, followingCount };
};

/**
 * Check if userA follows userB
 */
followSchema.statics.isFollowing = async function (followerId, followingId) {
  const doc = await this.findOne({ follower: followerId, following: followingId }).lean();
  return !!doc;
};

/**
 * Get follower count for a user
 */
followSchema.statics.getFollowerCount = async function (userId) {
  return this.countDocuments({ following: userId });
};

/**
 * Get following count for a user
 */
followSchema.statics.getFollowingCount = async function (userId) {
  return this.countDocuments({ follower: userId });
};

/**
 * Get follower IDs for a user (for feed queries, etc.)
 */
followSchema.statics.getFollowerIds = async function (userId) {
  const docs = await this.find({ following: userId }).select('follower').lean();
  return docs.map(d => d.follower);
};

/**
 * Get following IDs for a user
 */
followSchema.statics.getFollowingIds = async function (userId) {
  const docs = await this.find({ follower: userId }).select('following').lean();
  return docs.map(d => d.following);
};

module.exports = mongoose.model('Follow', followSchema);

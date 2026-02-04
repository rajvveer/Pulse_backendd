const mongoose = require('mongoose');

/**
 * Like Model - Production-grade like tracking
 * 
 * Replaces embedded arrays for O(1) lookups and atomic operations.
 * Supports likes on posts, reels, and comments.
 */
const likeSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    targetType: {
        type: String,
        enum: ['post', 'reel', 'comment'],
        required: true
    },

    targetId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'targetTypeModel'
    },

    // Virtual ref path for population
    targetTypeModel: {
        type: String,
        enum: ['Post', 'Reel', 'Comment', 'ReelComment'],
        required: true
    }
}, {
    timestamps: true
});

// =========================================================
//  INDEXES - Critical for production performance
// =========================================================

// Unique compound index - prevents duplicate likes
likeSchema.index({ user: 1, targetType: 1, targetId: 1 }, { unique: true });

// Fast lookup: "did user X like item Y?"
likeSchema.index({ targetType: 1, targetId: 1, user: 1 });

// Fast count: "how many likes does item Y have?"
likeSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

// Velocity tracking: likes in time window for trending
likeSchema.index({ targetType: 1, targetId: 1, createdAt: 1 });

// User's like history
likeSchema.index({ user: 1, createdAt: -1 });

// =========================================================
//  STATIC METHODS - Atomic operations
// =========================================================

/**
 * Toggle like - atomic like/unlike operation
 * @returns {Object} { liked: boolean, likeCount: number }
 */
likeSchema.statics.toggleLike = async function (userId, targetType, targetId) {
    const modelMap = { post: 'Post', reel: 'Reel', comment: 'Comment' };
    const targetTypeModel = modelMap[targetType];

    const existing = await this.findOne({ user: userId, targetType, targetId });

    if (existing) {
        // Unlike
        await this.deleteOne({ _id: existing._id });
        const count = await this.countDocuments({ targetType, targetId });
        return { liked: false, likeCount: count };
    } else {
        // Like
        await this.create({ user: userId, targetType, targetId, targetTypeModel });
        const count = await this.countDocuments({ targetType, targetId });
        return { liked: true, likeCount: count };
    }
};

/**
 * Check if user liked an item - O(1) lookup
 */
likeSchema.statics.isLikedBy = async function (userId, targetType, targetId) {
    const count = await this.countDocuments({ user: userId, targetType, targetId });
    return count > 0;
};

/**
 * Bulk check likes - for feed rendering
 * @returns {Set} Set of liked targetIds
 */
likeSchema.statics.getLikedIds = async function (userId, targetType, targetIds) {
    const likes = await this.find({
        user: userId,
        targetType,
        targetId: { $in: targetIds }
    }).select('targetId').lean();

    return new Set(likes.map(l => l.targetId.toString()));
};

/**
 * Get like count for an item
 */
likeSchema.statics.getLikeCount = async function (targetType, targetId) {
    return this.countDocuments({ targetType, targetId });
};

/**
 * Get like velocity - likes per hour for trending
 */
likeSchema.statics.getLikeVelocity = async function (targetType, targetId, hoursWindow = 1) {
    const since = new Date(Date.now() - hoursWindow * 60 * 60 * 1000);
    const count = await this.countDocuments({
        targetType,
        targetId,
        createdAt: { $gte: since }
    });
    return count / hoursWindow;
};

/**
 * Batch get like counts - optimized for feeds
 */
likeSchema.statics.getBatchLikeCounts = async function (targetType, targetIds) {
    const pipeline = [
        { $match: { targetType, targetId: { $in: targetIds.map(id => new mongoose.Types.ObjectId(id)) } } },
        { $group: { _id: '$targetId', count: { $sum: 1 } } }
    ];

    const results = await this.aggregate(pipeline);
    const countMap = new Map();
    results.forEach(r => countMap.set(r._id.toString(), r.count));

    // Fill in zeros for items with no likes
    targetIds.forEach(id => {
        if (!countMap.has(id.toString())) countMap.set(id.toString(), 0);
    });

    return countMap;
};

module.exports = mongoose.model('Like', likeSchema);

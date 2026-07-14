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

    // Delete-first toggle: deleteOne both checks and removes in one atomic
    // operation, so concurrent requests can't double-create or throw E11000.
    const deleted = await this.deleteOne({ user: userId, targetType, targetId });

    if (deleted.deletedCount > 0) {
        // Unlike
        const count = await this.countDocuments({ targetType, targetId });
        return { liked: false, likeCount: count };
    }

    // Like — a concurrent request may have just created it; the unique index
    // makes that a duplicate-key error, which we treat as "already liked".
    try {
        await this.create({ user: userId, targetType, targetId, targetTypeModel });
    } catch (err) {
        if (err.code !== 11000) throw err;
    }
    const count = await this.countDocuments({ targetType, targetId });
    return { liked: true, likeCount: count };
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
 * Batch get like velocities - one aggregation for a whole feed candidate set
 * instead of one countDocuments per post.
 * @returns {Map} targetId(string) -> likes per hour in the window
 */
likeSchema.statics.getBatchLikeVelocities = async function (targetType, targetIds, hoursWindow = 1) {
    const since = new Date(Date.now() - hoursWindow * 60 * 60 * 1000);
    const objectIds = targetIds.map(id => {
        try {
            return new mongoose.Types.ObjectId(id.toString());
        } catch (e) {
            return id;
        }
    });

    const results = await this.aggregate([
        { $match: { targetType, targetId: { $in: objectIds }, createdAt: { $gte: since } } },
        { $group: { _id: '$targetId', count: { $sum: 1 } } }
    ]);

    const velocityMap = new Map();
    results.forEach(r => velocityMap.set(r._id.toString(), r.count / hoursWindow));
    targetIds.forEach(id => {
        const key = id.toString();
        if (!velocityMap.has(key)) velocityMap.set(key, 0);
    });
    return velocityMap;
};

/**
 * Batch get like counts - optimized for feeds
 */
likeSchema.statics.getBatchLikeCounts = async function (targetType, targetIds) {
    // Convert all IDs to ObjectId for consistent matching
    const objectIds = targetIds.map(id => {
        try {
            return new mongoose.Types.ObjectId(id.toString());
        } catch (e) {
            return id;
        }
    });

    const pipeline = [
        { $match: { targetType, targetId: { $in: objectIds } } },
        { $group: { _id: '$targetId', count: { $sum: 1 } } }
    ];

    const results = await this.aggregate(pipeline);
    const countMap = new Map();

    // Map results with string keys for consistency
    results.forEach(r => countMap.set(r._id.toString(), r.count));

    // Fill in zeros for items with no likes
    targetIds.forEach(id => {
        const key = id.toString();
        if (!countMap.has(key)) countMap.set(key, 0);
    });

    return countMap;
};

module.exports = mongoose.model('Like', likeSchema);

const mongoose = require('mongoose');

/**
 * UserEngagement Model - Tracks user-to-user interaction signals
 * 
 * Used for personalization: "User A engages heavily with User B's content"
 * This powers the affinity score in feed ranking.
 */
const userEngagementSchema = new mongoose.Schema({
    // The user whose feed we're personalizing
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // The content creator user interacts with
    targetUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // Engagement signals - all normalized 0-1 or raw counts
    signals: {
        // Content interactions
        views: { type: Number, default: 0 },
        likes: { type: Number, default: 0 },
        comments: { type: Number, default: 0 },
        shares: { type: Number, default: 0 },

        // Time-based engagement
        totalWatchTimeSeconds: { type: Number, default: 0 },
        avgWatchPercentage: { type: Number, default: 0 },

        // Social interactions
        profileVisits: { type: Number, default: 0 },
        dmsSent: { type: Number, default: 0 },

        // Negative signals
        hides: { type: Number, default: 0 },
        reports: { type: Number, default: 0 }
    },

    // Computed affinity score (updated on signal change)
    affinityScore: {
        type: Number,
        default: 0,
        index: true
    },

    // Last interaction timestamp for decay
    lastInteraction: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: true
});

// =========================================================
//  INDEXES
// =========================================================

// Primary lookup: user's engagement with target
userEngagementSchema.index({ user: 1, targetUser: 1 }, { unique: true });

// Get top affinities for a user (for personalization)
userEngagementSchema.index({ user: 1, affinityScore: -1 });

// Cleanup stale engagements
userEngagementSchema.index({ lastInteraction: 1 });

// =========================================================
//  CONSTANTS - Tunable weights
// =========================================================

const SIGNAL_WEIGHTS = {
    views: 0.1,
    likes: 1.0,
    comments: 2.0,
    shares: 3.0,
    totalWatchTimeSeconds: 0.01, // Per second
    profileVisits: 0.5,
    dmsSent: 2.5,
    hides: -5.0,
    reports: -10.0
};

const DECAY_HALF_LIFE_DAYS = 14; // Affinity halves every 2 weeks without interaction

// =========================================================
//  METHODS
// =========================================================

/**
 * Recalculate affinity score based on signals
 */
userEngagementSchema.methods.recalculateAffinity = function () {
    let score = 0;

    for (const [signal, weight] of Object.entries(SIGNAL_WEIGHTS)) {
        const value = this.signals[signal] || 0;
        score += value * weight;
    }

    // Apply time decay
    const daysSinceInteraction = (Date.now() - this.lastInteraction) / (1000 * 60 * 60 * 24);
    const decayFactor = Math.pow(0.5, daysSinceInteraction / DECAY_HALF_LIFE_DAYS);

    this.affinityScore = Math.max(0, score * decayFactor);
    return this.affinityScore;
};

// =========================================================
//  STATIC METHODS
// =========================================================

/**
 * Record an engagement signal
 */
userEngagementSchema.statics.recordSignal = async function (userId, targetUserId, signalType, value = 1) {
    if (userId.toString() === targetUserId.toString()) return null; // No self-engagement

    const update = {
        $inc: { [`signals.${signalType}`]: value },
        $set: { lastInteraction: new Date() }
    };

    const engagement = await this.findOneAndUpdate(
        { user: userId, targetUser: targetUserId },
        update,
        { upsert: true, new: true }
    );

    // Recalculate affinity
    engagement.recalculateAffinity();
    await engagement.save();

    return engagement;
};

/**
 * Get affinity score between two users
 */
userEngagementSchema.statics.getAffinity = async function (userId, targetUserId) {
    const engagement = await this.findOne({ user: userId, targetUser: targetUserId });
    return engagement ? engagement.affinityScore : 0;
};

/**
 * Get top affinities for a user (for feed personalization)
 */
userEngagementSchema.statics.getTopAffinities = async function (userId, limit = 50) {
    const engagements = await this.find({ user: userId })
        .sort({ affinityScore: -1 })
        .limit(limit)
        .select('targetUser affinityScore')
        .lean();

    const affinityMap = new Map();
    engagements.forEach(e => affinityMap.set(e.targetUser.toString(), e.affinityScore));
    return affinityMap;
};

/**
 * Batch get affinities - optimized for feed ranking
 */
userEngagementSchema.statics.getBatchAffinities = async function (userId, targetUserIds) {
    const engagements = await this.find({
        user: userId,
        targetUser: { $in: targetUserIds }
    }).select('targetUser affinityScore').lean();

    const affinityMap = new Map();
    engagements.forEach(e => affinityMap.set(e.targetUser.toString(), e.affinityScore));

    // Fill zeros for unknown users
    targetUserIds.forEach(id => {
        if (!affinityMap.has(id.toString())) affinityMap.set(id.toString(), 0);
    });

    return affinityMap;
};

/**
 * Decay all engagements (run as scheduled job)
 */
userEngagementSchema.statics.applyGlobalDecay = async function () {
    const staleThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days

    // Delete very stale engagements
    await this.deleteMany({ lastInteraction: { $lt: staleThreshold }, affinityScore: { $lt: 1 } });

    // Recalculate remaining — stream with a cursor instead of loading the
    // entire collection into memory
    const cursor = this.find({}).cursor();
    for (let engagement = await cursor.next(); engagement != null; engagement = await cursor.next()) {
        engagement.recalculateAffinity();
        await engagement.save();
    }
};

module.exports = mongoose.model('UserEngagement', userEngagementSchema);

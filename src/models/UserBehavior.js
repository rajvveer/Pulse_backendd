const mongoose = require('mongoose');

/**
 * UserBehavior Model - Deep behavior tracking for addictive personalization
 * 
 * Tracks: content preferences, session patterns, dopamine responses
 * Powers: Variable Ratio Reinforcement, Interest Profiling, Session Pacing
 */
const userBehaviorSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },

    // =========================================================
    //  CONTENT AFFINITIES - What type of content user loves
    // =========================================================
    contentAffinities: {
        // Topic preferences (learned from engaged content)
        topics: {
            type: Map,
            of: Number,  // topic -> affinity score (0-1)
            default: new Map()
        },

        // Media type preferences
        mediaTypes: {
            video: { type: Number, default: 0.5 },
            image: { type: Number, default: 0.5 },
            text: { type: Number, default: 0.5 },
            gif: { type: Number, default: 0.5 }
        },

        // Post length preferences
        postLengths: {
            short: { type: Number, default: 0.5 },   // < 50 chars
            medium: { type: Number, default: 0.5 },  // 50-200 chars
            long: { type: Number, default: 0.5 }     // > 200 chars
        },

        // Author categories/niches user engages with
        authorCategories: {
            type: Map,
            of: Number,
            default: new Map()
        }
    },

    // =========================================================
    //  SESSION PATTERNS - For addiction mechanics
    // =========================================================
    sessionPatterns: {
        avgSessionDurationMs: { type: Number, default: 0 },
        totalSessions: { type: Number, default: 0 },

        // Peak activity hours (0-23)
        peakHours: [{
            hour: { type: Number, min: 0, max: 23 },
            weight: { type: Number, default: 1 }
        }],

        // Scroll behavior
        avgScrollVelocity: { type: Number, default: 0 },  // pixels/sec
        avgDwellTimeMs: { type: Number, default: 0 },     // time spent per post

        // Engagement thresholds (learned)
        dwellTimeToLikeMs: { type: Number, default: 2000 },  // avg time before liking
        postsPerSession: { type: Number, default: 0 }
    },

    // =========================================================
    //  ENGAGEMENT VELOCITY - How fast user acts
    // =========================================================
    engagementVelocity: {
        avgTimeToLikeMs: { type: Number, default: 0 },
        avgTimeToCommentMs: { type: Number, default: 0 },
        likeRate: { type: Number, default: 0 },  // likes per post viewed
        commentRate: { type: Number, default: 0 }
    },

    // =========================================================
    //  REWARD SENSITIVITY - For Variable Ratio Reinforcement
    // =========================================================
    rewardSensitivity: {
        // How much does high-engagement content boost session length?
        engagementSensitivity: { type: Number, default: 0.5 },

        // Does user prefer viral content or niche?
        viralPreference: { type: Number, default: 0.5 },  // 0 = niche, 1 = viral

        // Novelty vs familiar preference
        noveltyPreference: { type: Number, default: 0.5 },  // 0 = familiar, 1 = new

        // Social proof influence
        socialProofInfluence: { type: Number, default: 0.5 }  // 0 = low, 1 = high
    },

    // =========================================================
    //  SEEN CONTENT TRACKING - For freshness
    // =========================================================
    recentlySeenPosts: [{
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
        seenAt: { type: Date, default: Date.now }
    }],

    // Current session info
    currentSession: {
        startedAt: { type: Date },
        postsViewed: { type: Number, default: 0 },
        likesGiven: { type: Number, default: 0 },
        lastActivityAt: { type: Date }
    },

    // Last profile update
    lastProfileUpdate: { type: Date, default: Date.now }
}, {
    timestamps: true
});

// =========================================================
//  INDEXES
// =========================================================

userBehaviorSchema.index({ user: 1 });
userBehaviorSchema.index({ 'currentSession.lastActivityAt': 1 });

// =========================================================
//  CONSTANTS
// =========================================================

const AFFINITY_DECAY = 0.95;  // Decay factor per day for topic affinities
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;  // 30 min = new session
const MAX_RECENT_POSTS = 500;  // Track last 500 seen posts

// =========================================================
//  STATIC METHODS
// =========================================================

/**
 * Get or create behavior profile for user
 */
userBehaviorSchema.statics.getOrCreate = async function (userId) {
    let behavior = await this.findOne({ user: userId });
    if (!behavior) {
        behavior = await this.create({ user: userId });
    }
    return behavior;
};

/**
 * Record a content view
 */
userBehaviorSchema.statics.recordView = async function (userId, post, dwellTimeMs = 0) {
    const behavior = await this.getOrCreate(userId);
    const now = new Date();

    // Check if new session
    const isNewSession = !behavior.currentSession.startedAt ||
        (now - behavior.currentSession.lastActivityAt) > SESSION_TIMEOUT_MS;

    if (isNewSession) {
        // Save previous session stats
        if (behavior.currentSession.postsViewed > 0) {
            const sessionDuration = behavior.currentSession.lastActivityAt - behavior.currentSession.startedAt;
            behavior.sessionPatterns.totalSessions += 1;
            behavior.sessionPatterns.avgSessionDurationMs =
                (behavior.sessionPatterns.avgSessionDurationMs * (behavior.sessionPatterns.totalSessions - 1) + sessionDuration) /
                behavior.sessionPatterns.totalSessions;
            behavior.sessionPatterns.postsPerSession =
                (behavior.sessionPatterns.postsPerSession * (behavior.sessionPatterns.totalSessions - 1) + behavior.currentSession.postsViewed) /
                behavior.sessionPatterns.totalSessions;
        }

        // Start new session
        behavior.currentSession = {
            startedAt: now,
            postsViewed: 0,
            likesGiven: 0,
            lastActivityAt: now
        };
    }

    // Update current session
    behavior.currentSession.postsViewed += 1;
    behavior.currentSession.lastActivityAt = now;

    // Track dwell time
    if (dwellTimeMs > 0) {
        const prevAvg = behavior.sessionPatterns.avgDwellTimeMs || 0;
        behavior.sessionPatterns.avgDwellTimeMs =
            prevAvg * 0.9 + dwellTimeMs * 0.1;  // Exponential moving average
    }

    // Track seen post
    behavior.recentlySeenPosts.push({ postId: post._id || post, seenAt: now });
    if (behavior.recentlySeenPosts.length > MAX_RECENT_POSTS) {
        behavior.recentlySeenPosts = behavior.recentlySeenPosts.slice(-MAX_RECENT_POSTS);
    }

    // Update content affinities based on viewed content
    await behavior.updateAffinitiesFromPost(post, dwellTimeMs);

    await behavior.save();
    return behavior;
};

/**
 * Record a like action
 */
userBehaviorSchema.statics.recordLike = async function (userId, post, timeSinceViewMs = 0) {
    const behavior = await this.getOrCreate(userId);

    behavior.currentSession.likesGiven += 1;

    // Update engagement velocity
    if (timeSinceViewMs > 0) {
        const prevAvg = behavior.engagementVelocity.avgTimeToLikeMs || 0;
        behavior.engagementVelocity.avgTimeToLikeMs = prevAvg * 0.8 + timeSinceViewMs * 0.2;
    }

    // Calculate like rate
    if (behavior.currentSession.postsViewed > 0) {
        behavior.engagementVelocity.likeRate =
            behavior.currentSession.likesGiven / behavior.currentSession.postsViewed;
    }

    // Boost affinities for liked content (like = strong signal)
    await behavior.updateAffinitiesFromPost(post, 0, 2.0);  // 2x weight for likes

    await behavior.save();
    return behavior;
};

/**
 * Get recently seen post IDs (for deduplication)
 */
userBehaviorSchema.statics.getSeenPostIds = async function (userId, withinHours = 24) {
    const behavior = await this.findOne({ user: userId }).select('recentlySeenPosts').lean();
    if (!behavior) return new Set();

    const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000);
    const seenIds = behavior.recentlySeenPosts
        .filter(p => p.seenAt >= cutoff)
        .map(p => p.postId.toString());

    return new Set(seenIds);
};

/**
 * Get user's content preferences for ranking
 */
userBehaviorSchema.statics.getPreferences = async function (userId) {
    const behavior = await this.findOne({ user: userId }).lean();
    if (!behavior) {
        return {
            mediaTypes: { video: 0.5, image: 0.5, text: 0.5, gif: 0.5 },
            topics: new Map(),
            noveltyPreference: 0.5,
            viralPreference: 0.5,
            socialProofInfluence: 0.5,
            sessionDepth: 0
        };
    }

    return {
        mediaTypes: behavior.contentAffinities?.mediaTypes || {},
        topics: behavior.contentAffinities?.topics || new Map(),
        noveltyPreference: behavior.rewardSensitivity?.noveltyPreference || 0.5,
        viralPreference: behavior.rewardSensitivity?.viralPreference || 0.5,
        socialProofInfluence: behavior.rewardSensitivity?.socialProofInfluence || 0.5,
        sessionDepth: behavior.currentSession?.postsViewed || 0
    };
};

// =========================================================
//  INSTANCE METHODS
// =========================================================

/**
 * Update content affinities based on post interaction
 */
userBehaviorSchema.methods.updateAffinitiesFromPost = async function (post, dwellTimeMs = 0, multiplier = 1.0) {
    if (!post) return;

    const postObj = typeof post.toObject === 'function' ? post.toObject() : post;

    // Engagement weight (longer dwell = higher signal)
    const dwellWeight = dwellTimeMs > 0 ? Math.min(dwellTimeMs / 5000, 2) : 0.5;
    const weight = dwellWeight * multiplier;

    // Update media type affinity
    const mediaType = this.getMediaType(postObj);
    if (this.contentAffinities.mediaTypes[mediaType] !== undefined) {
        this.contentAffinities.mediaTypes[mediaType] =
            Math.min(1, this.contentAffinities.mediaTypes[mediaType] * 0.95 + 0.05 * weight);
    }

    // Update post length affinity
    const textLength = postObj.content?.text?.length || 0;
    let lengthKey = 'short';
    if (textLength > 200) lengthKey = 'long';
    else if (textLength > 50) lengthKey = 'medium';

    this.contentAffinities.postLengths[lengthKey] =
        Math.min(1, this.contentAffinities.postLengths[lengthKey] * 0.95 + 0.05 * weight);

    // Update topic affinities (from hashtags)
    const hashtags = postObj.content?.hashtags || [];
    for (const tag of hashtags) {
        const normalized = tag.toLowerCase();
        const current = this.contentAffinities.topics.get(normalized) || 0;
        this.contentAffinities.topics.set(normalized, Math.min(1, current + 0.1 * weight));
    }

    this.lastProfileUpdate = new Date();
};

/**
 * Get media type from post
 */
userBehaviorSchema.methods.getMediaType = function (post) {
    const media = post.content?.media || [];
    if (media.length === 0) return 'text';
    const types = media.map(m => m.type);
    if (types.includes('video')) return 'video';
    if (types.includes('gif')) return 'gif';
    if (types.includes('image')) return 'image';
    return 'text';
};

module.exports = mongoose.model('UserBehavior', userBehaviorSchema);

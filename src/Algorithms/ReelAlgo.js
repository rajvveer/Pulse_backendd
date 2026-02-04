/**
 * ReelAlgo.js - Instagram/X Style Reel Feed Ranking Algorithm
 * 
 * Combines engagement scoring, time decay, and personalization
 * to rank reels for the "For You" feed.
 */

const UserEngagement = require('../models/UserEngagement');
const Like = require('../models/Like');

// =========================================================
//  CONFIGURATION - Tunable parameters
// =========================================================

const CONFIG = {
    // Time decay - content freshness
    HALF_LIFE_HOURS: 24,          // Score halves every 24 hours
    MAX_AGE_HOURS: 168,           // 7 days max age for consideration

    // Engagement weights
    WEIGHTS: {
        likes: 1.0,
        comments: 2.5,
        shares: 4.0,
        views: 0.1,
        avgWatchPercentage: 3.0,    // Completion rate is gold
        saves: 2.0
    },

    // Personalization
    PERSONALIZATION_WEIGHT: 0.35,  // 35% of final score
    FOLLOW_BOOST: 1.5,             // Multiplier for followed creators

    // Diversity injection
    DIVERSITY_RATE: 0.1,           // 10% random content
    DIVERSITY_RECENCY_BOOST: 0.5,  // Boost for very new content

    // Velocity (trending)
    VELOCITY_WINDOW_HOURS: 1,
    VELOCITY_WEIGHT: 2.0,

    // Quality signals
    CREATOR_SCORE_WEIGHT: 0.15,
    VERIFIED_BOOST: 1.1
};

// =========================================================
//  ENGAGEMENT SCORING
// =========================================================

/**
 * Calculate raw engagement score for a reel
 * @param {Object} reel - Reel document with stats
 * @returns {number} Weighted engagement score
 */
function calculateEngagementScore(reel) {
    const stats = reel.stats || {};

    const likeScore = (stats.likes || reel.likes?.length || 0) * CONFIG.WEIGHTS.likes;
    const commentScore = (stats.comments || reel.commentsCount || 0) * CONFIG.WEIGHTS.comments;
    const shareScore = (stats.shares || 0) * CONFIG.WEIGHTS.shares;
    const viewScore = (stats.views || 0) * CONFIG.WEIGHTS.views;
    const watchScore = (stats.avgWatchPercentage || 0) * CONFIG.WEIGHTS.avgWatchPercentage;
    const saveScore = (stats.saves || 0) * CONFIG.WEIGHTS.saves;

    return likeScore + commentScore + shareScore + viewScore + watchScore + saveScore;
}

/**
 * Calculate like velocity (likes per hour) for trending
 */
async function calculateVelocity(reelId) {
    const velocity = await Like.getLikeVelocity('reel', reelId, CONFIG.VELOCITY_WINDOW_HOURS);
    return velocity * CONFIG.VELOCITY_WEIGHT;
}

// =========================================================
//  TIME DECAY
// =========================================================

/**
 * Apply time decay using half-life function
 * @param {number} score - Raw score
 * @param {Date} createdAt - Content creation time
 * @returns {number} Decayed score
 */
function applyTimeDecay(score, createdAt) {
    const hoursAge = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);

    // Content too old - minimal score
    if (hoursAge > CONFIG.MAX_AGE_HOURS) {
        return score * 0.01;
    }

    // Half-life decay: score * 0.5^(age/halfLife)
    const decayFactor = Math.pow(0.5, hoursAge / CONFIG.HALF_LIFE_HOURS);
    return score * decayFactor;
}

/**
 * Get freshness boost for very new content
 */
function getFreshnessBoost(createdAt) {
    const hoursAge = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);

    if (hoursAge < 1) return 2.0;      // < 1 hour: 2x boost
    if (hoursAge < 6) return 1.5;      // < 6 hours: 1.5x boost
    if (hoursAge < 24) return 1.2;     // < 24 hours: 1.2x boost
    return 1.0;
}

// =========================================================
//  PERSONALIZATION
// =========================================================

/**
 * Get personalization boost based on user affinity
 * @param {string} userId - Viewing user
 * @param {string} authorId - Content creator
 * @param {Map} affinityCache - Pre-fetched affinities
 * @param {Set} followingSet - User's following set
 */
function getPersonalizationBoost(userId, authorId, affinityCache, followingSet) {
    if (!userId || !authorId) return 0;

    let boost = 0;

    // Affinity from engagement history
    const affinity = affinityCache?.get(authorId.toString()) || 0;
    boost += affinity * CONFIG.PERSONALIZATION_WEIGHT;

    // Follow boost
    if (followingSet?.has(authorId.toString())) {
        boost *= CONFIG.FOLLOW_BOOST;
    }

    return boost;
}

/**
 * Get creator quality score
 */
function getCreatorScore(author) {
    if (!author) return 0;

    let score = 0;

    // Verified boost
    if (author.isVerified) score += CONFIG.VERIFIED_BOOST;

    // Follower count (logarithmic to prevent mega-influencer domination)
    const followers = author.stats?.followers || 0;
    if (followers > 0) {
        score += Math.log10(followers + 1) * 0.5;
    }

    // Engagement rate (if available)
    const engagementRate = author.stats?.engagementRate || 0;
    score += engagementRate * 2;

    return score * CONFIG.CREATOR_SCORE_WEIGHT;
}

// =========================================================
//  DIVERSITY INJECTION
// =========================================================

/**
 * Inject diversity into ranked feed
 * Prevents filter bubbles by including some random content
 */
function injectDiversity(rankedReels, allReels) {
    if (!allReels || allReels.length === 0) return rankedReels;

    const diversityCount = Math.floor(rankedReels.length * CONFIG.DIVERSITY_RATE);
    if (diversityCount === 0) return rankedReels;

    const rankedIds = new Set(rankedReels.map(r => r._id.toString()));
    const unrankedReels = allReels.filter(r => !rankedIds.has(r._id.toString()));

    // Random selection from unranked
    const diversityPicks = [];
    for (let i = 0; i < Math.min(diversityCount, unrankedReels.length); i++) {
        const randomIndex = Math.floor(Math.random() * unrankedReels.length);
        diversityPicks.push(unrankedReels.splice(randomIndex, 1)[0]);
    }

    // Insert at random positions
    const result = [...rankedReels];
    diversityPicks.forEach(pick => {
        const insertIndex = Math.floor(Math.random() * (result.length - 3)) + 3; // After top 3
        result.splice(insertIndex, 0, { ...pick, isDiversity: true });
    });

    return result;
}

// =========================================================
//  MAIN RANKING FUNCTION
// =========================================================

/**
 * Rank reels for a user's feed
 * 
 * @param {Array} reels - Array of reel documents
 * @param {string} userId - Viewing user ID
 * @param {Object} options - Ranking options
 * @returns {Array} Sorted reels with scores
 */
async function rankReels(reels, userId, options = {}) {
    if (!reels || reels.length === 0) return [];

    const {
        includeVelocity = true,
        injectDiversityContent = true,
        followingIds = []
    } = options;

    // Pre-fetch personalization data
    const authorIds = reels.map(r => (r.user?._id || r.user || r.author?._id || r.author).toString());
    const uniqueAuthorIds = [...new Set(authorIds)];

    let affinityCache = new Map();
    const followingSet = new Set(followingIds.map(id => id.toString()));

    if (userId) {
        affinityCache = await UserEngagement.getBatchAffinities(userId, uniqueAuthorIds);
    }

    // Score each reel
    const scoredReels = await Promise.all(reels.map(async (reel) => {
        const authorId = (reel.user?._id || reel.user || reel.author?._id || reel.author)?.toString();
        const author = reel.user || reel.author || {};

        // Base engagement score
        let score = calculateEngagementScore(reel);

        // Apply time decay
        score = applyTimeDecay(score, reel.createdAt);

        // Add freshness boost
        score *= getFreshnessBoost(reel.createdAt);

        // Add velocity for trending
        if (includeVelocity) {
            const velocity = await calculateVelocity(reel._id);
            score += velocity;
        }

        // Add personalization
        const personalBoost = getPersonalizationBoost(userId, authorId, affinityCache, followingSet);
        score += personalBoost;

        // Add creator score
        score += getCreatorScore(author);

        return {
            ...reel,
            _score: score,
            _personalBoost: personalBoost
        };
    }));

    // Sort by score descending
    scoredReels.sort((a, b) => b._score - a._score);

    // Inject diversity
    if (injectDiversityContent && reels.length > 10) {
        return injectDiversity(scoredReels, reels);
    }

    return scoredReels;
}

/**
 * Get "For You" feed - personalized discovery
 */
async function getForYouFeed(userId, reels, options = {}) {
    // Exclude user's own content for discovery (but only if there's enough other content)
    const otherReels = reels.filter(r => {
        const authorId = (r.user?._id || r.user || r.author?._id || r.author)?.toString();
        return authorId !== userId?.toString();
    });

    // If not enough other content, include user's own reels too
    const discoveryReels = otherReels.length >= 5 ? otherReels : reels;

    return rankReels(discoveryReels, userId, {
        ...options,
        injectDiversityContent: true
    });
}

/**
 * Get "Following" feed - chronological with light ranking
 */
async function getFollowingFeed(userId, reels, followingIds) {
    // Filter to followed creators
    const followingSet = new Set(followingIds.map(id => id.toString()));
    const followedReels = reels.filter(r => {
        const authorId = (r.user?._id || r.user || r.author?._id || r.author)?.toString();
        return followingSet.has(authorId) || authorId === userId?.toString();
    });

    // Light ranking - mostly chronological with engagement tiebreaker
    return rankReels(followedReels, userId, {
        includeVelocity: false,
        injectDiversityContent: false,
        followingIds
    });
}

// =========================================================
//  EXPORTS
// =========================================================

module.exports = {
    // Core functions
    calculateEngagementScore,
    applyTimeDecay,
    getFreshnessBoost,
    getPersonalizationBoost,
    getCreatorScore,
    calculateVelocity,

    // Main ranking
    rankReels,
    getForYouFeed,
    getFollowingFeed,
    injectDiversity,

    // Config (for testing/tuning)
    CONFIG
};

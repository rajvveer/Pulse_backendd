/**
 * UserAlgo.js - User Relevance & Recommendation Algorithm
 * 
 * Calculates creator scores, interest affinity, and generates
 * user recommendations (who to follow).
 */

const UserEngagement = require('../models/UserEngagement');

// =========================================================
//  CONFIGURATION
// =========================================================

const CONFIG = {
    // Creator score weights
    CREATOR_WEIGHTS: {
        followers: 0.3,
        engagementRate: 0.4,
        contentQuality: 0.2,
        consistency: 0.1
    },

    // Follower scaling (logarithmic to prevent mega-influencer domination)
    FOLLOWER_LOG_BASE: 10,
    MAX_FOLLOWER_SCORE: 5,

    // Engagement rate thresholds
    EXCELLENT_ENGAGEMENT: 0.06,   // 6%+
    GOOD_ENGAGEMENT: 0.03,        // 3%+

    // Recommendation weights
    FOLLOW_OVERLAP_WEIGHT: 2.0,   // Mutual follows
    ENGAGEMENT_HISTORY_WEIGHT: 1.5,
    CONTENT_SIMILARITY_WEIGHT: 1.0,

    // Diversity in recommendations
    RECOMMENDATION_DIVERSITY: 0.2,

    // Verified boost
    VERIFIED_BOOST: 1.3
};

// =========================================================
//  CREATOR SCORING
// =========================================================

/**
 * Calculate creator quality score
 * Used for: content ranking, search results, recommendations
 */
function calculateCreatorScore(user) {
    if (!user) return 0;

    const stats = user.stats || {};
    let score = 0;

    // 1. Follower score (logarithmic)
    const followers = stats.followers || 0;
    if (followers > 0) {
        const followerScore = Math.min(
            Math.log(followers + 1) / Math.log(CONFIG.FOLLOWER_LOG_BASE),
            CONFIG.MAX_FOLLOWER_SCORE
        );
        score += followerScore * CONFIG.CREATOR_WEIGHTS.followers;
    }

    // 2. Engagement rate score
    const engagementRate = calculateEngagementRate(user);
    let engagementScore = 0;
    if (engagementRate >= CONFIG.EXCELLENT_ENGAGEMENT) {
        engagementScore = 1.0;
    } else if (engagementRate >= CONFIG.GOOD_ENGAGEMENT) {
        engagementScore = 0.7;
    } else {
        engagementScore = engagementRate / CONFIG.GOOD_ENGAGEMENT * 0.7;
    }
    score += engagementScore * CONFIG.CREATOR_WEIGHTS.engagementRate;

    // 3. Content quality (avg likes per post)
    const posts = stats.posts || 0;
    const totalLikes = stats.totalLikes || 0;
    if (posts > 0) {
        const avgLikes = totalLikes / posts;
        const qualityScore = Math.min(Math.log10(avgLikes + 1) / 3, 1);
        score += qualityScore * CONFIG.CREATOR_WEIGHTS.contentQuality;
    }

    // 4. Consistency (posts per week if available)
    const postsPerWeek = stats.postsPerWeek || 0;
    if (postsPerWeek >= 3) {
        score += 1.0 * CONFIG.CREATOR_WEIGHTS.consistency;
    } else if (postsPerWeek >= 1) {
        score += 0.5 * CONFIG.CREATOR_WEIGHTS.consistency;
    }

    // Verified boost
    if (user.isVerified) {
        score *= CONFIG.VERIFIED_BOOST;
    }

    return score;
}

/**
 * Calculate engagement rate
 */
function calculateEngagementRate(user) {
    const stats = user.stats || {};
    const followers = stats.followers || 0;

    if (followers === 0) return 0;

    const recentEngagement = stats.recentLikes || 0 + (stats.recentComments || 0) * 2;
    const recentPosts = stats.recentPosts || 1;

    return (recentEngagement / recentPosts) / followers;
}

// =========================================================
//  INTEREST AFFINITY
// =========================================================

/**
 * Get interest affinity between users
 * High score = user likely to enjoy target's content
 */
async function getInterestAffinity(userId, targetUserId) {
    if (!userId || !targetUserId) return 0;
    if (userId.toString() === targetUserId.toString()) return 0;

    return UserEngagement.getAffinity(userId, targetUserId);
}

/**
 * Get batch affinities for multiple targets
 */
async function getBatchAffinities(userId, targetUserIds) {
    return UserEngagement.getBatchAffinities(userId, targetUserIds);
}

/**
 * Calculate content similarity between users
 * Based on hashtags, topics, engagement patterns
 */
function calculateContentSimilarity(user1, user2) {
    // Placeholder - would use actual content analysis
    const interests1 = new Set(user1.interests || []);
    const interests2 = new Set(user2.interests || []);

    if (interests1.size === 0 || interests2.size === 0) return 0;

    // Jaccard similarity
    const intersection = [...interests1].filter(i => interests2.has(i)).length;
    const union = new Set([...interests1, ...interests2]).size;

    return intersection / union;
}

// =========================================================
//  USER RECOMMENDATIONS
// =========================================================

/**
 * Get suggested users to follow
 */
async function getSuggestedUsers(userId, candidateUsers, options = {}) {
    const {
        followingIds = [],
        mutualFollows = [],
        limit = 20
    } = options;

    const followingSet = new Set(followingIds.map(id => id.toString()));
    const userIdStr = userId?.toString();

    // Filter out already following and self
    const candidates = candidateUsers.filter(u => {
        const uid = (u._id || u).toString();
        return uid !== userIdStr && !followingSet.has(uid);
    });

    if (candidates.length === 0) return [];

    // Get affinities
    const candidateIds = candidates.map(u => (u._id || u).toString());
    const affinities = await getBatchAffinities(userId, candidateIds);

    // Score candidates
    const scored = candidates.map(user => {
        const uid = (user._id || user).toString();
        let score = 0;

        // Creator quality
        score += calculateCreatorScore(user);

        // Engagement history (affinity)
        const affinity = affinities.get(uid) || 0;
        score += affinity * CONFIG.ENGAGEMENT_HISTORY_WEIGHT;

        // Mutual follows boost
        const mutualSet = new Set(mutualFollows.map(id => id.toString()));
        if (mutualSet.has(uid)) {
            score *= CONFIG.FOLLOW_OVERLAP_WEIGHT;
        }

        return { ...user, _recommendScore: score };
    });

    // Sort by score
    scored.sort((a, b) => b._recommendScore - a._recommendScore);

    // Inject diversity
    const result = injectDiversity(scored, limit);

    return result.slice(0, limit);
}

/**
 * Inject diversity into recommendations
 */
function injectDiversity(sortedUsers, limit) {
    const diversityCount = Math.floor(limit * CONFIG.RECOMMENDATION_DIVERSITY);
    if (diversityCount === 0 || sortedUsers.length <= limit) return sortedUsers;

    const top = sortedUsers.slice(0, limit - diversityCount);
    const rest = sortedUsers.slice(limit - diversityCount);

    // Random picks from rest
    const diversePicks = [];
    for (let i = 0; i < Math.min(diversityCount, rest.length); i++) {
        const idx = Math.floor(Math.random() * rest.length);
        diversePicks.push(rest.splice(idx, 1)[0]);
    }

    return [...top, ...diversePicks];
}

/**
 * Get users similar to a target user
 * (for "Profiles like this" feature)
 */
async function getSimilarUsers(targetUser, candidateUsers, limit = 10) {
    const targetId = (targetUser._id || targetUser).toString();

    // Filter out the target
    const candidates = candidateUsers.filter(u =>
        (u._id || u).toString() !== targetId
    );

    // Score by similarity
    const scored = candidates.map(user => {
        let score = 0;

        // Content similarity
        score += calculateContentSimilarity(targetUser, user) * CONFIG.CONTENT_SIMILARITY_WEIGHT;

        // Similar follower count (users in same tier)
        const targetFollowers = targetUser.stats?.followers || 0;
        const userFollowers = user.stats?.followers || 0;
        const followerRatio = Math.min(targetFollowers, userFollowers) /
            Math.max(targetFollowers, userFollowers, 1);
        score += followerRatio * 0.5;

        // Creator quality
        score += calculateCreatorScore(user) * 0.3;

        return { ...user, _similarityScore: score };
    });

    scored.sort((a, b) => b._similarityScore - a._similarityScore);

    return scored.slice(0, limit);
}

/**
 * Get trending creators (rising stars)
 */
function getTrendingCreators(users, options = {}) {
    const { limit = 10, minFollowers = 100 } = options;

    // Filter by minimum followers
    const eligible = users.filter(u => (u.stats?.followers || 0) >= minFollowers);

    // Calculate growth/velocity (placeholder - would use historical data)
    const withGrowth = eligible.map(user => {
        const stats = user.stats || {};

        // Engagement velocity
        const engagementRate = calculateEngagementRate(user);
        const followerGrowth = stats.followerGrowthRate || 0;

        const trendScore = engagementRate * 10 + followerGrowth;

        return { ...user, _trendScore: trendScore };
    });

    withGrowth.sort((a, b) => b._trendScore - a._trendScore);

    return withGrowth.slice(0, limit);
}

// =========================================================
//  EXPORTS
// =========================================================

module.exports = {
    calculateCreatorScore,
    calculateEngagementRate,
    calculateContentSimilarity,
    getInterestAffinity,
    getBatchAffinities,
    getSuggestedUsers,
    getSimilarUsers,
    getTrendingCreators,
    injectDiversity,
    CONFIG
};

/**
 * feedAlgo.js - Addictive Post Feed Ranking Algorithm
 * 
 * Implements:
 * - Variable Ratio Reinforcement (VRR) - Unpredictable reward patterns
 * - Curiosity Gap Injection - Intriguing content placement
 * - Session-Aware Pacing - Dopamine curve management
 * - Social Proof Amplification - Friend engagement boosts
 * - Deep Interest Personalization - Content type matching
 */

const UserEngagement = require('../models/UserEngagement');
const UserBehavior = require('../models/UserBehavior');
const Like = require('../models/Like');
const InterestProfiler = require('./InterestProfiler');
const VibeClassifier = require('./VibeClassifier');

// =========================================================
//  CONFIGURATION
// =========================================================

const CONFIG = {
    // Time decay
    HALF_LIFE_HOURS: 12,
    MAX_AGE_HOURS: 72,

    // Engagement weights
    WEIGHTS: {
        likes: 1.0,
        comments: 3.0,
        shares: 4.0,
        retweets: 5.0,
        quotes: 4.5,
        bookmarks: 2.0,
        views: 0.05,
        replies: 2.5
    },

    // Personalization
    PERSONALIZATION_WEIGHT: 0.6,  // Increased from 0.4
    FOLLOW_BOOST: 1.8,
    MUTUAL_FOLLOW_BOOST: 2.2,
    INTEREST_MATCH_BOOST: 2.5,    // NEW: Content type match

    // Media boosts
    MEDIA_BOOST: {
        image: 1.1,
        video: 1.3,
        gif: 1.05,
        text_only: 1.0
    },

    // Hashtag relevance
    TRENDING_HASHTAG_BOOST: 1.5,

    // Velocity
    VELOCITY_WINDOW_HOURS: 0.5,
    VELOCITY_WEIGHT: 3.0,

    // =========================================================
    //  ADDICTION MECHANICS CONFIG
    // =========================================================

    // Variable Ratio Reinforcement - Mix content unpredictably
    VRR: {
        HIGH_ENGAGEMENT: 0.55,    // 55% posts user will likely love
        DISCOVERY: 0.30,          // 30% new content to expand horizons
        WILDCARD: 0.15            // 15% random for dopamine surprise
    },

    // Session Pacing - Manage dopamine curve
    SESSION_PACING: {
        EARLY_BOOST: 1.5,         // First 5 posts: best content
        MID_DIP: 0.85,            // Posts 6-15: slight dip (creates seeking)
        LATE_SPIKE: 1.3,          // Posts 16+: re-spike to prevent exit
        EARLY_THRESHOLD: 5,
        MID_THRESHOLD: 15
    },

    // Social Proof - Friend activity boost
    SOCIAL_PROOF: {
        FRIEND_LIKE_BOOST: 0.8,   // Per friend who liked
        MAX_FRIEND_BOOST: 3.0,    // Cap at 3x
        MIN_FRIENDS_SHOW: 2       // Only show "friends liked" if 2+
    },

    // Curiosity Gap - Inject intriguing content
    CURIOSITY: {
        INJECTION_RATE: 0.1,      // 10% of feed
        TRENDING_BOOST: 2.0,      // Trending topics user hasn't seen
        CONTROVERSIAL_BOOST: 1.5  // High comment/like ratio
    },

    // Freshness - Never-seen content
    FRESHNESS: {
        NEW_CONTENT_BOOST: 1.4,
        SEEN_PENALTY: 0.3
    }
};

// =========================================================
//  CORE SCORING FUNCTIONS
// =========================================================

/**
 * Calculate base engagement score
 */
function calculatePostScore(post) {
    const stats = post.stats || {};
    let score = 0;

    score += (stats.likes || post.likes?.length || 0) * CONFIG.WEIGHTS.likes;
    score += (stats.comments || 0) * CONFIG.WEIGHTS.comments;
    score += (stats.shares || 0) * CONFIG.WEIGHTS.shares;
    score += (stats.views || 0) * CONFIG.WEIGHTS.views;

    // Media type boost
    const mediaType = getMediaType(post);
    score *= CONFIG.MEDIA_BOOST[mediaType] || 1.0;

    return score;
}

/**
 * Get post media type
 */
function getMediaType(post) {
    const media = post.content?.media || [];
    if (media.length === 0) return 'text_only';
    const types = media.map(m => m.type);
    if (types.includes('video')) return 'video';
    if (types.includes('gif')) return 'gif';
    if (types.includes('image')) return 'image';
    return 'text_only';
}

/**
 * Apply time decay
 */
function applyTimeDecay(score, createdAt) {
    const hoursAge = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
    if (hoursAge > CONFIG.MAX_AGE_HOURS) return score * 0.005;
    const decayFactor = Math.pow(0.5, hoursAge / CONFIG.HALF_LIFE_HOURS);
    return score * decayFactor;
}

/**
 * Get trending velocity
 */
async function getTrendingVelocity(postId) {
    const velocity = await Like.getLikeVelocity('post', postId, CONFIG.VELOCITY_WINDOW_HOURS);
    return velocity * CONFIG.VELOCITY_WEIGHT;
}

/**
 * Get hashtag boost
 */
function getHashtagBoost(post, trendingHashtags = []) {
    const postHashtags = post.content?.hashtags || [];
    if (postHashtags.length === 0) return 0;
    const trendingSet = new Set(trendingHashtags.map(h => h.toLowerCase()));
    const matchCount = postHashtags.filter(h => trendingSet.has(h.toLowerCase())).length;
    return matchCount * CONFIG.TRENDING_HASHTAG_BOOST;
}

// =========================================================
//  ADDICTION MECHANICS
// =========================================================

/**
 * Variable Ratio Reinforcement - Categorize posts into reward tiers
 */
function assignVRRCategory(post, userRelevance) {
    // High relevance + high engagement = HIGH tier
    const engagementScore = calculatePostScore(post);
    const combinedScore = userRelevance * 0.6 + (Math.log10(engagementScore + 1) / 5) * 0.4;

    if (combinedScore > 0.7) return 'HIGH';
    if (combinedScore > 0.4) return 'DISCOVERY';
    return 'WILDCARD';
}

/**
 * Apply VRR distribution to feed
 * Mixes content unpredictably based on target ratios
 */
function applyVRRDistribution(scoredPosts, userBehavior) {
    if (scoredPosts.length < 10) return scoredPosts;

    const highPosts = scoredPosts.filter(p => p._vrrCategory === 'HIGH');
    const discoveryPosts = scoredPosts.filter(p => p._vrrCategory === 'DISCOVERY');
    const wildcardPosts = scoredPosts.filter(p => p._vrrCategory === 'WILDCARD');

    const targetLength = scoredPosts.length;
    const result = [];

    // Calculate target counts
    const highCount = Math.floor(targetLength * CONFIG.VRR.HIGH_ENGAGEMENT);
    const discoveryCount = Math.floor(targetLength * CONFIG.VRR.DISCOVERY);
    const wildcardCount = targetLength - highCount - discoveryCount;

    // Take from each category
    result.push(...highPosts.slice(0, highCount));
    result.push(...discoveryPosts.slice(0, discoveryCount));
    result.push(...wildcardPosts.slice(0, wildcardCount));

    // Shuffle to make pattern unpredictable (key to addiction)
    return shuffleWithBias(result, highPosts.slice(0, 3));
}

/**
 * Shuffle array but keep some high-value posts at strategic positions
 */
function shuffleWithBias(posts, topPosts) {
    // Keep top post at position 0 (hook)
    // Keep another top post around position 5-7 (re-engagement)
    // Rest is shuffled

    const result = [...posts];
    const topIds = new Set(topPosts.map(p => (p._id || p).toString()));

    // Fisher-Yates shuffle for non-top posts
    for (let i = result.length - 1; i > 0; i--) {
        const postId = (result[i]._id || result[i]).toString();
        if (topIds.has(postId)) continue;  // Don't move top posts

        const j = Math.floor(Math.random() * (i + 1));
        const jPostId = (result[j]._id || result[j]).toString();
        if (topIds.has(jPostId)) continue;  // Don't swap with top posts

        [result[i], result[j]] = [result[j], result[i]];
    }

    // Ensure a top post is at position 0
    if (topPosts.length > 0) {
        const hookIndex = result.findIndex(p => (p._id || p).toString() === (topPosts[0]._id || topPosts[0]).toString());
        if (hookIndex > 0) {
            [result[0], result[hookIndex]] = [result[hookIndex], result[0]];
        }
    }

    return result;
}

/**
 * Session-Aware Pacing - Adjust scores based on session depth
 */
function applySessionPacing(posts, sessionDepth) {
    return posts.map((post, index) => {
        const positionInSession = sessionDepth + index;
        let pacingMultiplier = 1.0;

        if (positionInSession < CONFIG.SESSION_PACING.EARLY_THRESHOLD) {
            // Early session: BEST content (hook them)
            pacingMultiplier = CONFIG.SESSION_PACING.EARLY_BOOST;
        } else if (positionInSession < CONFIG.SESSION_PACING.MID_THRESHOLD) {
            // Mid session: Slight dip (creates seeking behavior)
            pacingMultiplier = CONFIG.SESSION_PACING.MID_DIP;
        } else {
            // Late session: Re-spike (prevent exit)
            pacingMultiplier = CONFIG.SESSION_PACING.LATE_SPIKE;
        }

        return {
            ...post,
            _score: (post._score || 0) * pacingMultiplier,
            _pacingPhase: positionInSession < 5 ? 'early' : positionInSession < 15 ? 'mid' : 'late'
        };
    });
}

/**
 * Social Proof Amplification - Boost posts friends liked
 */
async function applySocialProof(posts, userId, friendIds = []) {
    if (!friendIds || friendIds.length === 0) return posts;

    const friendSet = new Set(friendIds.map(id => id.toString()));
    const postIds = posts.map(p => (p._id || p).toString());

    // Batch get friend likes
    const friendLikes = await Like.find({
        user: { $in: friendIds },
        targetType: 'post',
        targetId: { $in: postIds }
    }).select('targetId user').lean();

    // Count friend likes per post
    const friendLikeMap = new Map();
    friendLikes.forEach(like => {
        const postId = like.targetId.toString();
        const current = friendLikeMap.get(postId) || { count: 0, friends: [] };
        current.count++;
        current.friends.push(like.user.toString());
        friendLikeMap.set(postId, current);
    });

    // Apply boost
    return posts.map(post => {
        const postId = (post._id || post).toString();
        const friendData = friendLikeMap.get(postId);

        if (friendData && friendData.count >= CONFIG.SOCIAL_PROOF.MIN_FRIENDS_SHOW) {
            const boost = Math.min(
                friendData.count * CONFIG.SOCIAL_PROOF.FRIEND_LIKE_BOOST,
                CONFIG.SOCIAL_PROOF.MAX_FRIEND_BOOST
            );
            return {
                ...post,
                _score: (post._score || 0) * (1 + boost),
                _friendsLiked: friendData.count,
                _socialProofBoost: boost
            };
        }
        return post;
    });
}

/**
 * Curiosity Gap Injection - Add intriguing content
 */
function injectCuriosityGaps(posts, seenTopics = new Set()) {
    return posts.map(post => {
        const postTopics = InterestProfiler.extractTopics(post);
        let curiosityBoost = 0;

        // Boost trending topics user hasn't engaged with
        for (const topic of postTopics) {
            if (!seenTopics.has(topic)) {
                curiosityBoost += 0.3;  // New topic = curiosity
            }
        }

        // Boost "controversial" posts (high engagement ratio)
        const stats = post.stats || {};
        const commentToLikeRatio = (stats.comments || 0) / ((stats.likes || 1));
        if (commentToLikeRatio > 0.15) {  // More than 15% comment rate = discussion
            curiosityBoost += CONFIG.CURIOSITY.CONTROVERSIAL_BOOST;
        }

        return {
            ...post,
            _score: (post._score || 0) + curiosityBoost,
            _curiosityBoost: curiosityBoost
        };
    });
}

/**
 * Apply freshness boost/penalty
 */
function applyFreshness(posts, seenPostIds) {
    return posts.map(post => {
        const postId = (post._id || post).toString();
        const isSeen = seenPostIds.has(postId);

        return {
            ...post,
            _score: (post._score || 0) * (isSeen ? CONFIG.FRESHNESS.SEEN_PENALTY : CONFIG.FRESHNESS.NEW_CONTENT_BOOST),
            _isSeen: isSeen
        };
    });
}

// =========================================================
//  MAIN RANKING FUNCTION
// =========================================================

/**
 * Rank posts with full addiction mechanics
 */
async function rankPosts(posts, userId, options = {}) {
    if (!posts || posts.length === 0) return [];

    const {
        followingIds = [],
        mutualIds = [],
        friendIds = [],
        trendingHashtags = [],
        includeVelocity = true
    } = options;

    // Get user behavior data
    let userBehavior = null;
    let sessionDepth = 0;
    let seenPostIds = new Set();

    if (userId) {
        try {
            userBehavior = await UserBehavior.getPreferences(userId);
            sessionDepth = userBehavior.sessionDepth || 0;
            seenPostIds = await UserBehavior.getSeenPostIds(userId, 24);
        } catch (e) {
            // Graceful fallback for new users
        }
    }

    // Pre-fetch affinities
    const authorIds = posts.map(p => (p.author?._id || p.author).toString());
    const uniqueAuthorIds = [...new Set(authorIds)];

    let affinityCache = new Map();
    const followingSet = new Set(followingIds.map(id => id.toString()));
    const mutualSet = new Set(mutualIds.map(id => id.toString()));

    if (userId) {
        affinityCache = await UserEngagement.getBatchAffinities(userId, uniqueAuthorIds);
    }

    // Score each post with interest profiling
    const scoredPosts = await Promise.all(posts.map(async (post) => {
        const authorId = (post.author?._id || post.author)?.toString();

        // Base engagement score
        let score = calculatePostScore(post);

        // Time decay
        score = applyTimeDecay(score, post.createdAt);

        // Velocity
        if (includeVelocity) {
            const velocity = await getTrendingVelocity(post._id);
            score += velocity;
        }

        // Hashtag boost
        score += getHashtagBoost(post, trendingHashtags);

        // Author affinity
        const affinity = affinityCache?.get(authorId) || 0;
        score += affinity * CONFIG.PERSONALIZATION_WEIGHT;

        // Follow boosts
        if (mutualSet?.has(authorId)) {
            score *= CONFIG.MUTUAL_FOLLOW_BOOST;
        } else if (followingSet?.has(authorId)) {
            score *= CONFIG.FOLLOW_BOOST;
        }

        // Interest match (deep personalization)
        let relevanceScore = 5.0;  // Default neutral
        if (userId && userBehavior) {
            relevanceScore = await InterestProfiler.getRelevanceScore(post, userId, userBehavior);
            score += relevanceScore * CONFIG.INTEREST_MATCH_BOOST;
        }

        // Assign VRR category
        const vrrCategory = assignVRRCategory(post, relevanceScore / 10);

        return {
            ...post,
            _score: score,
            _relevanceScore: relevanceScore,
            _vrrCategory: vrrCategory
        };
    }));

    // Apply addiction mechanics pipeline
    let rankedPosts = scoredPosts;

    // 1. Freshness (seen/unseen)
    rankedPosts = applyFreshness(rankedPosts, seenPostIds);

    // 2. Curiosity gaps
    const seenTopics = userBehavior?.topics || new Map();
    rankedPosts = injectCuriosityGaps(rankedPosts, new Set(seenTopics.keys?.() || []));

    // 3. Social proof (if friends provided)
    if (friendIds && friendIds.length > 0) {
        rankedPosts = await applySocialProof(rankedPosts, userId, friendIds);
    }

    // 4. Sort by score
    rankedPosts.sort((a, b) => b._score - a._score);

    // 5. Apply VRR distribution (shuffle with pattern)
    rankedPosts = applyVRRDistribution(rankedPosts, userBehavior);

    // 6. Session pacing (adjust for session depth)
    rankedPosts = applySessionPacing(rankedPosts, sessionDepth);

    // Final sort after all adjustments
    rankedPosts.sort((a, b) => b._score - a._score);

    return rankedPosts;
}

/**
 * Get trending posts - pure velocity ranking
 */
async function getTrendingPosts(posts, options = {}) {
    const { timeRange = 6, limit = 20 } = options;
    const cutoff = new Date(Date.now() - timeRange * 60 * 60 * 1000);

    const recentPosts = posts.filter(p => new Date(p.createdAt) >= cutoff);

    const withVelocity = await Promise.all(recentPosts.map(async (post) => {
        const velocity = await getTrendingVelocity(post._id);
        const engagementScore = calculatePostScore(post);
        return { ...post, _velocity: velocity, _engagementScore: engagementScore };
    }));

    withVelocity.sort((a, b) => {
        if (b._velocity !== a._velocity) return b._velocity - a._velocity;
        return b._engagementScore - a._engagementScore;
    });

    return withVelocity.slice(0, limit);
}

/**
 * Get "For You" discovery feed
 */
async function getForYouFeed(userId, posts, options = {}) {
    const discoveryPosts = posts.filter(p => {
        const authorId = (p.author?._id || p.author)?.toString();
        return authorId !== userId?.toString();
    });

    return rankPosts(discoveryPosts, userId, options);
}

// =========================================================
//  VIBE-BASED FILTERING
// =========================================================

/**
 * Classify and attach vibe to posts
 */
function classifyPostVibes(posts) {
    return posts.map(post => {
        // Use existing vibe if already classified
        if (post.vibe && post.vibe !== 'general') {
            return post;
        }

        const classification = VibeClassifier.classify(post);
        return {
            ...post,
            vibe: classification.vibe,
            vibeScore: classification.vibeScore,
            _vibeConfidence: classification.confidence
        };
    });
}

/**
 * Filter posts by vibe
 */
function filterByVibe(posts, vibe) {
    if (!vibe || vibe === 'auto') return posts;

    return posts.filter(post => {
        // Primary vibe match
        if (post.vibe === vibe) return true;

        // High score in target vibe
        if (post.vibeScore && post.vibeScore[vibe] > 1.5) return true;

        // If still no match, check on-the-fly
        const classification = VibeClassifier.classify(post);
        return classification.vibe === vibe;
    });
}

/**
 * Rank posts with vibe filtering applied
 */
async function rankPostsWithVibe(posts, userId, options = {}) {
    const { vibe = 'auto', ...restOptions } = options;

    // First, classify all posts
    let classifiedPosts = classifyPostVibes(posts);

    // If specific vibe requested, filter first
    if (vibe && vibe !== 'auto') {
        classifiedPosts = filterByVibe(classifiedPosts, vibe);

        // Boost matching vibe posts
        classifiedPosts = VibeClassifier.boostByVibe(classifiedPosts, vibe, 1.5);
    }

    // Then apply normal ranking
    return rankPosts(classifiedPosts, userId, restOptions);
}

// =========================================================
//  EXPORTS
// =========================================================

module.exports = {
    calculatePostScore,
    applyTimeDecay,
    getTrendingVelocity,
    getHashtagBoost,
    assignVRRCategory,
    applyVRRDistribution,
    applySessionPacing,
    applySocialProof,
    injectCuriosityGaps,
    applyFreshness,
    rankPosts,
    rankPostsWithVibe,  // NEW: Vibe-aware ranking
    getTrendingPosts,
    getForYouFeed,
    getMediaType,
    classifyPostVibes,  // NEW
    filterByVibe,       // NEW
    CONFIG
};

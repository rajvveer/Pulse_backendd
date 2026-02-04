/**
 * InterestProfiler.js - Content Relevance Scoring
 * 
 * Analyzes user behavior to score content relevance.
 * Powers personalized feed ranking with deep interest matching.
 */

const UserBehavior = require('../models/UserBehavior');

// =========================================================
//  CONFIGURATION
// =========================================================

const CONFIG = {
    // Relevance weights
    WEIGHTS: {
        topicMatch: 3.0,       // User interested in this topic
        mediaTypeMatch: 1.5,   // User prefers this media type
        postLengthMatch: 0.8,  // User prefers this length
        authorAffinity: 2.0,   // User engages with this author
        freshness: 1.2         // Never-seen content boost
    },

    // Minimum affinity to consider a "match"
    AFFINITY_THRESHOLD: 0.3,

    // Topic extraction
    DEFAULT_TOPICS: ['general'],

    // Freshness decay (for seen content)
    SEEN_PENALTY: 0.3  // Reduce score by 70% if already seen
};

// =========================================================
//  MAIN FUNCTIONS
// =========================================================

/**
 * Score post relevance for a specific user
 * @returns {number} relevance score (0-10)
 */
async function getRelevanceScore(post, userId, userPrefs = null) {
    if (!post || !userId) return 1.0;

    // Get user preferences (cached or fetch)
    const prefs = userPrefs || await UserBehavior.getPreferences(userId);

    let score = 0;

    // 1. Topic Match
    const postTopics = extractTopics(post);
    const topicScore = calculateTopicMatch(postTopics, prefs.topics);
    score += topicScore * CONFIG.WEIGHTS.topicMatch;

    // 2. Media Type Match
    const mediaType = getMediaType(post);
    const mediaScore = prefs.mediaTypes?.[mediaType] || 0.5;
    score += mediaScore * CONFIG.WEIGHTS.mediaTypeMatch;

    // 3. Post Length Match
    const lengthKey = getPostLengthKey(post);
    const lengthScore = prefs.postLengths?.[lengthKey] || 0.5;
    score += lengthScore * CONFIG.WEIGHTS.postLengthMatch;

    // 4. Normalize to 0-10 scale
    const maxPossible = CONFIG.WEIGHTS.topicMatch + CONFIG.WEIGHTS.mediaTypeMatch + CONFIG.WEIGHTS.postLengthMatch;
    const normalizedScore = (score / maxPossible) * 10;

    return Math.max(0, Math.min(10, normalizedScore));
}

/**
 * Batch score multiple posts for efficiency
 */
async function batchScorePosts(posts, userId) {
    if (!posts || posts.length === 0) return posts;

    const prefs = await UserBehavior.getPreferences(userId);
    const seenIds = await UserBehavior.getSeenPostIds(userId, 24);

    const scored = await Promise.all(posts.map(async (post) => {
        const postId = (post._id || post).toString();
        let relevanceScore = await getRelevanceScore(post, userId, prefs);

        // Penalize seen content
        if (seenIds.has(postId)) {
            relevanceScore *= CONFIG.SEEN_PENALTY;
        }

        return {
            ...post,
            _relevanceScore: relevanceScore,
            _isSeen: seenIds.has(postId)
        };
    }));

    return scored;
}

/**
 * Extract topics from post content
 */
function extractTopics(post) {
    const topics = new Set();

    // From hashtags
    const hashtags = post.content?.hashtags || [];
    hashtags.forEach(tag => topics.add(tag.toLowerCase()));

    // From text keywords (simple extraction)
    const text = post.content?.text || '';
    const words = text.toLowerCase().split(/\s+/);

    // Look for common topic patterns
    const topicPatterns = {
        tech: ['tech', 'code', 'programming', 'developer', 'software', 'ai', 'startup'],
        lifestyle: ['life', 'lifestyle', 'daily', 'routine', 'morning', 'wellness'],
        memes: ['meme', 'lol', 'funny', 'joke', 'humor'],
        news: ['breaking', 'news', 'update', 'announced', 'reported'],
        sports: ['game', 'match', 'score', 'team', 'player', 'win', 'lost'],
        music: ['music', 'song', 'album', 'concert', 'artist', 'band'],
        food: ['food', 'recipe', 'cooking', 'restaurant', 'meal', 'delicious']
    };

    for (const [topic, keywords] of Object.entries(topicPatterns)) {
        if (keywords.some(kw => words.includes(kw) || text.includes(kw))) {
            topics.add(topic);
        }
    }

    return topics.size > 0 ? [...topics] : CONFIG.DEFAULT_TOPICS;
}

/**
 * Calculate topic match score
 */
function calculateTopicMatch(postTopics, userTopics) {
    if (!userTopics || userTopics.size === 0) return 0.5;  // Neutral for new users

    let totalAffinity = 0;
    let matchCount = 0;

    for (const topic of postTopics) {
        const affinity = userTopics.get ? userTopics.get(topic) : (userTopics[topic] || 0);
        if (affinity >= CONFIG.AFFINITY_THRESHOLD) {
            totalAffinity += affinity;
            matchCount++;
        }
    }

    if (matchCount === 0) return 0.2;  // Low score for no match
    return totalAffinity / matchCount;
}

/**
 * Get media type from post
 */
function getMediaType(post) {
    const media = post.content?.media || [];
    if (media.length === 0) return 'text';
    const types = media.map(m => m.type);
    if (types.includes('video')) return 'video';
    if (types.includes('gif')) return 'gif';
    if (types.includes('image')) return 'image';
    return 'text';
}

/**
 * Get post length category
 */
function getPostLengthKey(post) {
    const textLength = post.content?.text?.length || 0;
    if (textLength > 200) return 'long';
    if (textLength > 50) return 'medium';
    return 'short';
}

/**
 * Get user's top interests for recommendations
 */
async function getTopInterests(userId, limit = 10) {
    const prefs = await UserBehavior.getPreferences(userId);
    const topics = prefs.topics;

    if (!topics || topics.size === 0) return [];

    // Sort topics by affinity
    const entries = topics instanceof Map ? [...topics.entries()] : Object.entries(topics);
    entries.sort((a, b) => b[1] - a[1]);

    return entries.slice(0, limit).map(([topic, affinity]) => ({ topic, affinity }));
}

// =========================================================
//  EXPORTS
// =========================================================

module.exports = {
    getRelevanceScore,
    batchScorePosts,
    extractTopics,
    calculateTopicMatch,
    getMediaType,
    getPostLengthKey,
    getTopInterests,
    CONFIG
};

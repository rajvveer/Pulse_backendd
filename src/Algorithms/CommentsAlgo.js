/**
 * CommentsAlgo.js - Comment Ranking Algorithm
 * 
 * Ranks comments by quality, engagement, and recency.
 * Supports top/new/controversial sorting modes.
 */

const Like = require('../models/Like');

// =========================================================
//  CONFIGURATION
// =========================================================

const CONFIG = {
    // Sorting modes
    SORT_MODES: {
        TOP: 'top',
        NEW: 'new',
        CONTROVERSIAL: 'controversial',
        BEST: 'best'
    },

    // Quality weights
    WEIGHTS: {
        likes: 1.0,
        replies: 2.5,
        length_bonus: 0.01,        // Per character up to max
        author_karma: 0.1
    },

    // Quality thresholds
    MIN_QUALITY_LENGTH: 10,
    OPTIMAL_LENGTH: 280,         // Twitter-length sweet spot
    MAX_LENGTH_BONUS: 100,

    // Time decay
    HALF_LIFE_HOURS: 6,          // Comments decay faster

    // Author reputation
    VERIFIED_BOOST: 1.5,
    OP_BOOST: 2.0,               // Original poster boost

    // Controversial calculation
    CONTROVERSY_THRESHOLD: 0.3,  // Min ratio for controversial

    // Threading
    MAX_REPLY_DEPTH: 5,
    REPLY_DECAY_PER_LEVEL: 0.8
};

// =========================================================
//  QUALITY SCORING
// =========================================================

/**
 * Calculate comment quality score
 */
function calculateCommentQuality(comment, options = {}) {
    const { isOP = false } = options;

    let score = 0;
    const author = comment.author || {};

    // Like score
    const likeCount = comment.likes?.length || 0;
    score += likeCount * CONFIG.WEIGHTS.likes;

    // Reply engagement
    const replyCount = comment.replies?.length || 0;
    score += replyCount * CONFIG.WEIGHTS.replies;

    // Length quality bonus (reward thoughtful comments)
    const contentLength = (comment.content || '').length;
    if (contentLength >= CONFIG.MIN_QUALITY_LENGTH) {
        const lengthBonus = Math.min(contentLength, CONFIG.OPTIMAL_LENGTH) * CONFIG.WEIGHTS.length_bonus;
        score += Math.min(lengthBonus, CONFIG.MAX_LENGTH_BONUS);
    }

    // Author reputation
    if (author.isVerified) score *= CONFIG.VERIFIED_BOOST;
    if (isOP) score *= CONFIG.OP_BOOST;

    // Author karma if available
    const karma = author.stats?.karma || author.stats?.reputation || 0;
    score += Math.log10(karma + 1) * CONFIG.WEIGHTS.author_karma;

    return score;
}

/**
 * Apply time decay to comment score
 */
function applyTimeDecay(score, createdAt) {
    const hoursAge = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
    const decayFactor = Math.pow(0.5, hoursAge / CONFIG.HALF_LIFE_HOURS);
    return score * decayFactor;
}

/**
 * Calculate controversy score (high engagement, mixed sentiment)
 * Uses likes vs dislikes ratio if available, otherwise reply rate
 */
function calculateControversy(comment) {
    const likes = comment.likes?.length || 0;
    const replies = comment.replies?.length || 0;

    // If no engagement, not controversial
    if (likes + replies < 3) return 0;

    // Controversy = high engagement with balanced ratio
    // Approximation: reply-to-like ratio (more replies = more debate)
    const replyRatio = replies / (likes + 1);

    if (replyRatio >= CONFIG.CONTROVERSY_THRESHOLD) {
        return (likes + replies) * replyRatio;
    }

    return 0;
}

// =========================================================
//  RANKING FUNCTIONS
// =========================================================

/**
 * Rank comments by mode
 */
async function rankComments(comments, options = {}) {
    const {
        mode = CONFIG.SORT_MODES.BEST,
        opId = null,
        includeReplies = true
    } = options;

    if (!comments || comments.length === 0) return [];

    // Score each comment
    const scoredComments = comments.map(comment => {
        const authorId = (comment.author?._id || comment.author)?.toString();
        const isOP = opId && authorId === opId.toString();

        let score = 0;

        switch (mode) {
            case CONFIG.SORT_MODES.TOP:
                score = calculateCommentQuality(comment, { isOP });
                break;

            case CONFIG.SORT_MODES.NEW:
                score = new Date(comment.createdAt).getTime();
                break;

            case CONFIG.SORT_MODES.CONTROVERSIAL:
                score = calculateControversy(comment);
                break;

            case CONFIG.SORT_MODES.BEST:
            default:
                // Best = quality with time decay
                score = calculateCommentQuality(comment, { isOP });
                score = applyTimeDecay(score, comment.createdAt);
                break;
        }

        return { ...comment, _score: score };
    });

    // Sort descending
    scoredComments.sort((a, b) => b._score - a._score);

    // Rank replies recursively
    if (includeReplies) {
        for (const comment of scoredComments) {
            if (comment.replies && comment.replies.length > 0) {
                comment.replies = await rankComments(comment.replies, {
                    mode,
                    opId,
                    includeReplies: true
                });
            }
        }
    }

    return scoredComments;
}

/**
 * Get optimized reply thread with depth limiting
 */
async function getReplyThread(comments, options = {}) {
    const { maxDepth = CONFIG.MAX_REPLY_DEPTH } = options;

    function processReplies(replies, depth = 0) {
        if (depth >= maxDepth || !replies || replies.length === 0) {
            return [];
        }

        // Apply depth decay to scores
        const decayFactor = Math.pow(CONFIG.REPLY_DECAY_PER_LEVEL, depth);

        return replies.map(reply => ({
            ...reply,
            _score: (reply._score || 0) * decayFactor,
            _depth: depth,
            replies: processReplies(reply.replies, depth + 1)
        }));
    }

    return comments.map(comment => ({
        ...comment,
        _depth: 0,
        replies: processReplies(comment.replies, 1)
    }));
}

/**
 * Flatten threaded comments for display
 */
function flattenThread(comments, maxItems = 100) {
    const result = [];

    function traverse(items, depth = 0) {
        for (const item of items) {
            if (result.length >= maxItems) return;

            result.push({
                ...item,
                _depth: depth,
                _hasMoreReplies: (item.replies?.length || 0) > 0 && depth >= CONFIG.MAX_REPLY_DEPTH
            });

            if (item.replies && depth < CONFIG.MAX_REPLY_DEPTH) {
                traverse(item.replies, depth + 1);
            }
        }
    }

    traverse(comments);
    return result;
}

/**
 * Get top comments for preview (like Instagram)
 */
async function getTopCommentsPreview(comments, limit = 3) {
    const ranked = await rankComments(comments, {
        mode: CONFIG.SORT_MODES.TOP,
        includeReplies: false
    });

    return ranked.slice(0, limit);
}

// =========================================================
//  SPAM/QUALITY DETECTION HOOKS
// =========================================================

/**
 * Basic spam detection (placeholder for ML integration)
 */
function isSpammy(comment) {
    const originalContent = comment.content || '';
    const content = originalContent.toLowerCase();

    // Basic checks
    const spamPatterns = [
        /follow\s*(me|back)/i,
        /check\s*(out|my)/i,
        /click\s*(here|link)/i,
        /free\s*(money|gift|follow)/i,
        /\b(dm|message)\s*me\b/i
    ];

    for (const pattern of spamPatterns) {
        if (pattern.test(content)) return true;
    }

    // Excessive caps (check on original content)
    const capsCount = (originalContent.match(/[A-Z]/g) || []).length;
    const capsRatio = capsCount / originalContent.length;
    if (capsRatio > 0.7 && originalContent.length > 10) return true;

    // Excessive repetition
    if (/(.)\1{4,}/.test(content)) return true;

    return false;
}

/**
 * Filter low quality comments
 */
function filterLowQuality(comments, threshold = 0) {
    return comments.filter(c => {
        if (isSpammy(c)) return false;
        if ((c._score || 0) < threshold) return false;
        return true;
    });
}

// =========================================================
//  EXPORTS
// =========================================================

module.exports = {
    calculateCommentQuality,
    applyTimeDecay,
    calculateControversy,
    rankComments,
    getReplyThread,
    flattenThread,
    getTopCommentsPreview,
    isSpammy,
    filterLowQuality,
    CONFIG
};

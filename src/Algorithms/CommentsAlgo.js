/**
 * CommentsAlgo v2.0 — Production-Grade Comment Ranking
 *
 * Upgrades:
 *  - Wilson score confidence interval (beats raw like count for small samples)
 *  - Pattern-based spam detection (link spam, repeated phrases, emoji floods)
 *  - Toxic content flagging (hate speech patterns, harassment keywords)
 *  - Author reputation weighting (PulseScore/verified status boost)
 *  - Engagement quality scoring (long thoughtful replies >> short reactions)
 *  - Reply chain quality analysis (comments sparking quality discussion = boosted)
 *
 * Exports are 100% backward-compatible.
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
        length_bonus: 0.01,
        author_karma: 0.1,
        wilson: 3.0,              // NEW: Wilson score weight
        replyChain: 1.5,          // NEW: Quality reply chain bonus
        substanceBonus: 2.0       // NEW: Substantive comment bonus
    },

    // Quality thresholds
    MIN_QUALITY_LENGTH: 10,
    OPTIMAL_LENGTH: 280,
    MAX_LENGTH_BONUS: 100,

    // Time decay
    HALF_LIFE_HOURS: 6,

    // Author reputation
    VERIFIED_BOOST: 1.5,
    OP_BOOST: 2.0,

    // PulseScore tiers for reputation (NEW)
    AUTHOR_REPUTATION_TIERS: {
        icon: { minScore: 800, boost: 1.4 },
        legend: { minScore: 600, boost: 1.25 },
        rising: { minScore: 400, boost: 1.15 },
        active: { minScore: 200, boost: 1.05 },
        newcomer: { minScore: 0, boost: 1.0 }
    },

    // Controversial calculation
    CONTROVERSY_THRESHOLD: 0.3,

    // Threading
    MAX_REPLY_DEPTH: 5,
    REPLY_DECAY_PER_LEVEL: 0.8,

    // Spam detection thresholds (NEW)
    SPAM: {
        MAX_CAPS_RATIO: 0.6,
        MAX_EMOJI_RATIO: 0.5,
        MAX_REPEATED_CHARS: 4,
        MIN_LENGTH_FOR_CAPS_CHECK: 10,
        MAX_LINKS: 2,
        DUPLICATE_THRESHOLD: 0.85
    },

    // Toxicity (NEW)
    TOXICITY: {
        SEVERE_PENALTY: -10,
        MODERATE_PENALTY: -5,
        MILD_PENALTY: -2
    }
};

// =========================================================
//  SPAM PATTERNS — Expanded
// =========================================================

const SPAM_PATTERNS = [
    /follow\s*(me|back)/i,
    /check\s*(out|my)\s*(profile|page|link|bio)/i,
    /click\s*(here|link|this)/i,
    /free\s*(money|gift|follow|likes|v-?bucks)/i,
    /\b(dm|message)\s*me\b/i,
    /\bsub(scribe)?\s*(to|my)\b/i,
    /\bpromo\s*code\b/i,
    /\bwin\s*(a|free|big)\b/i,
    /buy\s*(now|this|here)/i,
    /\b(whatsapp|telegram)\s*me\b/i,
    /make\s*\$?\d+\s*(a|per)\s*(day|hour|week)/i,
    /\b(cashapp|venmo|paypal)\b/i,
    /special\s*offer/i,
    /limited\s*time/i
];

// Link patterns for detecting link spam
const LINK_PATTERN = /https?:\/\/[^\s]+|www\.[^\s]+|bit\.ly\/[^\s]+|t\.co\/[^\s]+/gi;

// =========================================================
//  TOXICITY PATTERNS — Hate speech / harassment detection
// =========================================================

const TOXICITY_PATTERNS = {
    severe: [
        /\b(kys|kill\s*yourself|die\s*already)\b/i,
        /\b(k+i+l+l+\s*y+o+u+r+s+e+l+f+)\b/i
    ],
    moderate: [
        /\b(shut\s*up|stfu|gtfo)\b/i,
        /\b(you'?re?\s*(trash|garbage|useless|worthless|pathetic))\b/i,
        /\b(nobody\s*(likes|cares|asked))\b/i,
        /\b(go\s*(away|cry|die))\b/i,
        /\b(u\s*suck)\b/i
    ],
    mild: [
        /\b(cringe|ratio|L\s*take|bad\s*take|clown)\b/i,
        /\b(cope|seethe|mid)\b/i,
        /\b(touch\s*grass)\b/i
    ]
};

// =========================================================
//  SUBSTANCE ANALYSIS — Detecting thoughtful comments
// =========================================================

const SUBSTANCE_INDICATORS = {
    high: [
        /\b(because|since|therefore|however|although|moreover)\b/i,
        /\b(i\s*think|in\s*my\s*opinion|imo|i\s*believe|i\s*agree.*because)\b/i,
        /\b(for\s*example|such\s*as|similar\s*to|compared\s*to)\b/i,
        /\b(on\s*the\s*other\s*hand|alternatively|that\s*said)\b/i,
        /\?\s*$/                                                           // Ends with a question (invites discussion)
    ],
    low: [
        /^(lol|lmao|same|this|fr|real|facts|true|W|L|ratio|based|mid|💀|😂|🔥)+$/i,
        /^.{0,5}$/                                                         // Very short (< 6 chars)
    ]
};

// =========================================================
//  WILSON SCORE — Better ranking for small sample sizes
// =========================================================

/**
 * Wilson score lower bound for 95% confidence interval.
 * Handles the "1 like out of 1 view ≠ 100% approval" problem.
 * See: https://www.evanmiller.org/how-not-to-sort-by-average-rating.html
 *
 * @param {number} positive - Number of positive signals (likes)
 * @param {number} total - Total signals (likes + views, or likes + replies)
 * @returns {number} Wilson score (0 to 1)
 */
function wilsonScore(positive, total) {
    if (total === 0) return 0;

    const z = 1.96; // 95% confidence
    const p = positive / total;
    const denominator = 1 + (z * z) / total;
    const inner = p * (1 - p) / total + (z * z) / (4 * total * total);

    return (p + (z * z) / (2 * total) - z * Math.sqrt(inner)) / denominator;
}

// =========================================================
//  QUALITY SCORING
// =========================================================

/**
 * Calculate comment quality score — Upgraded
 */
function calculateCommentQuality(comment, options = {}) {
    const { isOP = false } = options;

    let score = 0;
    const author = comment.author || {};

    // ── 1. Wilson score (replaces raw like count) ──
    const likeCount = comment.likes?.length || 0;
    const replyCount = comment.replies?.length || 0;
    const totalEngagement = likeCount + replyCount;

    if (totalEngagement > 0) {
        const wilson = wilsonScore(likeCount, totalEngagement + 5); // +5 prior for smoothing
        score += wilson * CONFIG.WEIGHTS.wilson * totalEngagement;
    }

    // ── 2. Raw engagement (still matters for high-engagement comments) ──
    score += likeCount * CONFIG.WEIGHTS.likes;
    score += replyCount * CONFIG.WEIGHTS.replies;

    // ── 3. Length quality bonus (thoughtful comments) ──
    const contentLength = (comment.content || '').length;
    if (contentLength >= CONFIG.MIN_QUALITY_LENGTH) {
        const lengthBonus = Math.min(contentLength, CONFIG.OPTIMAL_LENGTH) * CONFIG.WEIGHTS.length_bonus;
        score += Math.min(lengthBonus, CONFIG.MAX_LENGTH_BONUS);
    }

    // ── 4. Substance analysis (NEW) ──
    const substanceScore = analyzeSubstance(comment.content || '');
    score += substanceScore * CONFIG.WEIGHTS.substanceBonus;

    // ── 5. Reply chain quality (NEW) ──
    if (replyCount > 0 && comment.replies) {
        const chainQuality = analyzeReplyChainQuality(comment.replies);
        score += chainQuality * CONFIG.WEIGHTS.replyChain;
    }

    // ── 6. Author reputation — Tiered (NEW) ──
    if (author.isVerified) score *= CONFIG.VERIFIED_BOOST;
    if (isOP) score *= CONFIG.OP_BOOST;

    // PulseScore-based reputation boost
    const pulseScore = author.pulseScore || author.stats?.pulseScore || 0;
    const reputationBoost = getReputationBoost(pulseScore);
    score *= reputationBoost;

    // Author karma
    const karma = author.stats?.karma || author.stats?.reputation || 0;
    score += Math.log10(karma + 1) * CONFIG.WEIGHTS.author_karma;

    // ── 7. Toxicity penalty (NEW) ──
    const toxicityPenalty = detectToxicity(comment.content || '');
    score += toxicityPenalty;

    return Math.max(0, score);
}

/**
 * Analyze substantive quality of a comment (NEW)
 * @returns {number} 0–2 substance score
 */
function analyzeSubstance(content) {
    if (!content) return 0;

    // Check for low-substance patterns
    for (const pattern of SUBSTANCE_INDICATORS.low) {
        if (pattern.test(content.trim())) return 0;
    }

    let score = 0.5; // Base score for non-trivial content

    // Check for high-substance patterns
    for (const pattern of SUBSTANCE_INDICATORS.high) {
        if (pattern.test(content)) {
            score += 0.4;
        }
    }

    // Word count bonus (more words = likely more thought)
    const wordCount = content.split(/\s+/).length;
    if (wordCount >= 15) score += 0.3;
    if (wordCount >= 30) score += 0.3;
    if (wordCount >= 50) score += 0.2;

    // Sentence structure (multiple sentences = organized thought)
    const sentenceCount = content.split(/[.!?]+/).filter(s => s.trim().length > 5).length;
    if (sentenceCount >= 2) score += 0.2;
    if (sentenceCount >= 3) score += 0.2;

    return Math.min(2, score);
}

/**
 * Analyze reply chain quality (NEW)
 * Comments that spark quality discussion get boosted
 */
function analyzeReplyChainQuality(replies) {
    if (!replies || replies.length === 0) return 0;

    let quality = 0;

    // More replies = more discussion
    quality += Math.min(1, replies.length * 0.2);

    // Check average substance of replies
    let totalSubstance = 0;
    for (const reply of replies.slice(0, 10)) {
        totalSubstance += analyzeSubstance(reply.content || '');
    }
    const avgSubstance = totalSubstance / Math.min(replies.length, 10);
    quality += avgSubstance * 0.5;

    // Diverse authors = real discussion (not just back-and-forth)
    const uniqueAuthors = new Set(
        replies.map(r => (r.author?._id || r.author)?.toString()).filter(Boolean)
    );
    if (uniqueAuthors.size >= 3) quality += 0.5;
    if (uniqueAuthors.size >= 5) quality += 0.3;

    return Math.min(3, quality);
}

/**
 * Get reputation boost from PulseScore (NEW)
 */
function getReputationBoost(pulseScore) {
    for (const tier of Object.values(CONFIG.AUTHOR_REPUTATION_TIERS)) {
        if (pulseScore >= tier.minScore) return tier.boost;
    }
    return 1.0;
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
 * Calculate controversy score — Improved
 */
function calculateControversy(comment) {
    const likes = comment.likes?.length || 0;
    const replies = comment.replies?.length || 0;

    if (likes + replies < 3) return 0;

    // Reply-to-like ratio (more replies relative to likes = more debate)
    const replyRatio = replies / (likes + 1);

    // Also check if replies are substantive (not just spam)
    let substantiveReplies = 0;
    if (comment.replies) {
        for (const reply of comment.replies.slice(0, 10)) {
            if (analyzeSubstance(reply.content || '') > 0.5) {
                substantiveReplies++;
            }
        }
    }

    const debateQuality = substantiveReplies / (Math.min(replies, 10) || 1);

    if (replyRatio >= CONFIG.CONTROVERSY_THRESHOLD) {
        return (likes + replies) * replyRatio * (0.5 + debateQuality * 0.5);
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

        // Apply spam penalty
        if (isSpammy(comment)) {
            score *= 0.1;
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
//  SPAM DETECTION — Upgraded
// =========================================================

/**
 * Advanced spam detection with multiple signal analysis
 */
function isSpammy(comment) {
    const originalContent = comment.content || '';
    const content = originalContent.toLowerCase();

    if (!content || content.length === 0) return false;

    let spamSignals = 0;

    // ── 1. Known spam patterns ──
    for (const pattern of SPAM_PATTERNS) {
        if (pattern.test(content)) {
            spamSignals += 2;
        }
    }

    // ── 2. Excessive links ──
    const links = content.match(LINK_PATTERN) || [];
    if (links.length > CONFIG.SPAM.MAX_LINKS) {
        spamSignals += 3;
    } else if (links.length > 0 && content.length < 50) {
        spamSignals += 1; // Short comment with a link
    }

    // ── 3. Excessive caps ──
    if (originalContent.length >= CONFIG.SPAM.MIN_LENGTH_FOR_CAPS_CHECK) {
        const capsCount = (originalContent.match(/[A-Z]/g) || []).length;
        const capsRatio = capsCount / originalContent.length;
        if (capsRatio > CONFIG.SPAM.MAX_CAPS_RATIO) {
            spamSignals += 1;
        }
    }

    // ── 4. Character repetition ──
    const repeatedPattern = new RegExp(`(.)\\1{${CONFIG.SPAM.MAX_REPEATED_CHARS},}`, 'g');
    if (repeatedPattern.test(content)) {
        spamSignals += 1;
    }

    // ── 5. Emoji flooding ──
    const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
    const emojis = content.match(emojiPattern) || [];
    if (emojis.length > 0) {
        const emojiRatio = emojis.length / (content.length || 1);
        if (emojiRatio > CONFIG.SPAM.MAX_EMOJI_RATIO && content.length > 5) {
            spamSignals += 1;
        }
    }

    // ── 6. Repeated phrases ──
    const words = content.split(/\s+/);
    if (words.length >= 6) {
        const wordCounts = {};
        for (const word of words) {
            wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
        const maxRepeat = Math.max(...Object.values(wordCounts));
        if (maxRepeat / words.length > 0.5) {
            spamSignals += 2;
        }
    }

    // ── 7. Hashtag stuffing ──
    const hashtags = content.match(/#\w+/g) || [];
    if (hashtags.length > 5) {
        spamSignals += 2;
    }

    // Threshold: 3+ signals = spam
    return spamSignals >= 3;
}

/**
 * Detect toxic content — returns penalty score (NEW)
 */
function detectToxicity(content) {
    if (!content) return 0;
    const lower = content.toLowerCase();
    let penalty = 0;

    for (const pattern of TOXICITY_PATTERNS.severe) {
        if (pattern.test(lower)) {
            penalty += CONFIG.TOXICITY.SEVERE_PENALTY;
        }
    }

    for (const pattern of TOXICITY_PATTERNS.moderate) {
        if (pattern.test(lower)) {
            penalty += CONFIG.TOXICITY.MODERATE_PENALTY;
        }
    }

    for (const pattern of TOXICITY_PATTERNS.mild) {
        if (pattern.test(lower)) {
            penalty += CONFIG.TOXICITY.MILD_PENALTY;
        }
    }

    return penalty;
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
    detectToxicity,           // NEW
    analyzeSubstance,         // NEW
    wilsonScore,              // NEW
    analyzeReplyChainQuality, // NEW
    CONFIG
};

/**
 * ReelAlgo v2.0 — Advanced Reel Feed Ranking
 *
 * Upgrades:
 *  - Watch-time completion scoring (finish rate > raw views)
 *  - Re-watch detection bonus (looped = high quality)
 *  - Audio/music affinity integration
 *  - Creator cold start handling (new creators get discovery boost)
 *  - Negative signal handling (skip/hide penalties)
 *  - Session-aware pacing for reel feeds
 *  - Category diversity (prevents same-topic saturation)
 *
 * Exports are 100% backward-compatible.
 */

const UserEngagement = require('../../models/UserEngagement');
const Like = require('../../models/Like');

const CONFIG = {
    HALF_LIFE_HOURS: 24,
    MAX_AGE_HOURS: 168,
    WEIGHTS: {
        likes: 1.0, comments: 2.5, shares: 4.0, views: 0.1,
        avgWatchPercentage: 3.0, saves: 2.0,
        // NEW weights
        completionRate: 4.0,     // Full watch = gold signal
        rewatch: 5.0,            // Rewatched = platinum signal
        skipRate: -2.0           // High skip = penalty
    },
    PERSONALIZATION_WEIGHT: 0.35,
    FOLLOW_BOOST: 1.5,
    DIVERSITY_RATE: 0.1,
    DIVERSITY_RECENCY_BOOST: 0.5,
    VELOCITY_WINDOW_HOURS: 1,
    VELOCITY_WEIGHT: 2.0,
    CREATOR_SCORE_WEIGHT: 0.15,
    VERIFIED_BOOST: 1.1,

    // ── NEW v2.0 Config ──
    COMPLETION: {
        EXCELLENT: 0.8,          // 80%+ watched = excellent
        GOOD: 0.5,              // 50%+ = good
        POOR: 0.2               // Below 20% = poor content signal
    },
    REWATCH: {
        MULTIPLIER: 1.5,        // Looped reels get 1.5x
        MIN_LOOPS: 1.5          // Must watch 1.5x duration to count
    },
    AUDIO: {
        TRENDING_BOOST: 1.3,    // Reel uses trending audio
        AFFINITY_WEIGHT: 0.5    // User likes this audio/song
    },
    CREATOR_COLD_START: {
        MAX_POSTS: 5,           // Creator with < 5 posts = cold start
        DISCOVERY_BOOST: 1.4,   // Boost for discovery
        MIN_QUALITY: 0.06       // 6% engagement rate (fix: 0.3 = 30% was unreachable)
    },
    SESSION: {
        EARLY_BOOST: 1.3,
        MID_DIP: 0.9,
        LATE_SPIKE: 1.2,
        EARLY_THRESHOLD: 5,
        MID_THRESHOLD: 15
    },
    NEGATIVE: {
        SKIP_PENALTY: 0.6,      // User skipped similar reels
        HIDE_PENALTY: 0.2       // User explicitly hid this type
    },
    CATEGORY_DIVERSITY: {
        MAX_CONSECUTIVE_SAME: 2,
        MAX_SAME_IN_BATCH: 4
    }
};

// ── Engagement Scoring — Enhanced ──
function calculateEngagementScore(reel) {
    const stats = reel.stats || {};
    let score = 0;

    // Core engagements
    score += (stats.likes || reel.likes?.length || 0) * CONFIG.WEIGHTS.likes;
    score += (stats.comments || reel.commentsCount || 0) * CONFIG.WEIGHTS.comments;
    score += (stats.shares || 0) * CONFIG.WEIGHTS.shares;
    score += (stats.views || 0) * CONFIG.WEIGHTS.views;
    score += (stats.saves || 0) * CONFIG.WEIGHTS.saves;

    // Watch completion (NEW) — the most important signal for reels
    const completion = stats.avgWatchPercentage || 0;
    if (completion >= CONFIG.COMPLETION.EXCELLENT) {
        score += CONFIG.WEIGHTS.completionRate * 1.5;
    } else if (completion >= CONFIG.COMPLETION.GOOD) {
        score += CONFIG.WEIGHTS.completionRate;
    } else if (completion < CONFIG.COMPLETION.POOR && (stats.views || 0) > 50) {
        score += CONFIG.WEIGHTS.skipRate; // Penalty for low completion with enough views
    } else {
        score += completion * CONFIG.WEIGHTS.avgWatchPercentage;
    }

    // Re-watch detection (NEW) — looped reels are gold
    const avgLoops = stats.avgLoops || stats.avgReplayCount || 0;
    if (avgLoops >= CONFIG.REWATCH.MIN_LOOPS) {
        score += CONFIG.WEIGHTS.rewatch * Math.min(avgLoops, 3); // Cap at 3x
    }

    return Math.max(0, score);
}

// ── Velocity ──
async function calculateVelocity(reelId) {
    return (await Like.getLikeVelocity('reel', reelId, CONFIG.VELOCITY_WINDOW_HOURS)) * CONFIG.VELOCITY_WEIGHT;
}

// ── Time Decay ──
function applyTimeDecay(score, createdAt) {
    const hoursAge = (Date.now() - new Date(createdAt).getTime()) / 3600000;
    if (hoursAge > CONFIG.MAX_AGE_HOURS) return score * 0.01;
    return score * Math.pow(0.5, hoursAge / CONFIG.HALF_LIFE_HOURS);
}

function getFreshnessBoost(createdAt) {
    const hrs = (Date.now() - new Date(createdAt).getTime()) / 3600000;
    if (hrs < 1) return 2.0;
    if (hrs < 6) return 1.5;
    if (hrs < 24) return 1.2;
    return 1.0;
}

// ── Personalization — Enhanced ──
function getPersonalizationBoost(userId, authorId, affinityCache, followingSet) {
    if (!userId || !authorId) return 0;
    let boost = (affinityCache?.get(authorId.toString()) || 0) * CONFIG.PERSONALIZATION_WEIGHT;
    if (followingSet?.has(authorId.toString())) boost *= CONFIG.FOLLOW_BOOST;
    return boost;
}

function getCreatorScore(author) {
    if (!author) return 0;
    let score = author.isVerified ? CONFIG.VERIFIED_BOOST : 0;
    const followers = author.stats?.followers || 0;
    if (followers > 0) score += Math.log10(followers + 1) * 0.5;
    score += (author.stats?.engagementRate || 0) * 2;
    return score * CONFIG.CREATOR_SCORE_WEIGHT;
}

// ── Audio Affinity (NEW) ──
function getAudioBoost(reel, userAudioPrefs = {}) {
    let boost = 0;
    const audioId = reel.audio?.id || reel.audioId;
    if (!audioId) return 0;

    // Trending audio bonus
    if (reel.audio?.isTrending) {
        boost += CONFIG.AUDIO.TRENDING_BOOST - 1;
    }

    // User audio affinity
    const affinity = userAudioPrefs[audioId] || 0;
    boost += affinity * CONFIG.AUDIO.AFFINITY_WEIGHT;

    return boost;
}

// ── Creator Cold Start (NEW) ──
function getCreatorColdStartBoost(author) {
    if (!author) return 0;
    const postCount = author.stats?.posts || author.stats?.reels || 0;
    if (postCount >= CONFIG.CREATOR_COLD_START.MAX_POSTS) return 0;

    // New creator with some quality signal
    const engagementRate = author.stats?.engagementRate || 0;
    if (engagementRate >= CONFIG.CREATOR_COLD_START.MIN_QUALITY) {
        return CONFIG.CREATOR_COLD_START.DISCOVERY_BOOST - 1;
    }

    // Even brand new creators get a small discovery boost
    return 0.1;
}

// ── Session Pacing for Reels (NEW) ──
function applyReelSessionPacing(reels, sessionDepth = 0) {
    return reels.map((reel, i) => {
        const pos = sessionDepth + i;
        let m = 1.0;
        if (pos < CONFIG.SESSION.EARLY_THRESHOLD) m = CONFIG.SESSION.EARLY_BOOST;
        else if (pos < CONFIG.SESSION.MID_THRESHOLD) m = CONFIG.SESSION.MID_DIP;
        else m = CONFIG.SESSION.LATE_SPIKE;
        return { ...reel, _score: (reel._score || 0) * m, _sessionPhase: pos < 5 ? 'early' : pos < 15 ? 'mid' : 'late' };
    });
}

// ── Category Diversity (NEW) ──
function enforceCategoryDiversity(reels) {
    if (reels.length < 3) return reels;

    const result = [];
    const deferred = [];
    const categoryCounts = {};

    for (const reel of reels) {
        const category = reel.category || reel.vibe || 'general';
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;

        // Check consecutive same category
        const prevCat = result.length > 0 ? (result[result.length - 1].category || result[result.length - 1].vibe || 'general') : null;
        const prevPrevCat = result.length > 1 ? (result[result.length - 2].category || result[result.length - 2].vibe || 'general') : null;

        if (category === prevCat && category === prevPrevCat) {
            deferred.push(reel);
        } else if (categoryCounts[category] > CONFIG.CATEGORY_DIVERSITY.MAX_SAME_IN_BATCH) {
            deferred.push(reel);
        } else {
            result.push(reel);
        }
    }

    // Re-insert deferred at suitable gaps
    for (const reel of deferred) {
        let inserted = false;
        const cat = reel.category || reel.vibe || 'general';
        for (let i = 2; i < result.length; i++) {
            const prevCat = result[i - 1].category || result[i - 1].vibe || 'general';
            if (prevCat !== cat) { result.splice(i, 0, reel); inserted = true; break; }
        }
        if (!inserted) result.push(reel);
    }

    return result;
}

// ── Diversity Injection ──
function injectDiversity(rankedReels, allReels) {
    if (!allReels || allReels.length === 0) return rankedReels;
    const diversityCount = Math.floor(rankedReels.length * CONFIG.DIVERSITY_RATE);
    if (diversityCount === 0) return rankedReels;

    const rankedIds = new Set(rankedReels.map(r => r._id.toString()));
    const unranked = allReels.filter(r => !rankedIds.has(r._id.toString()));

    const picks = [];
    for (let i = 0; i < Math.min(diversityCount, unranked.length); i++) {
        const idx = Math.floor(Math.random() * unranked.length);
        picks.push(unranked.splice(idx, 1)[0]);
    }

    const result = [...rankedReels];
    picks.forEach(pick => {
        const insertIdx = Math.floor(Math.random() * (result.length - 3)) + 3;
        result.splice(insertIdx, 0, { ...pick, isDiversity: true });
    });
    return result;
}

// ── Main Ranking — Enhanced ──
async function rankReels(reels, userId, options = {}) {
    if (!reels?.length) return [];

    const {
        includeVelocity = true,
        injectDiversityContent = true,
        followingIds = [],
        sessionDepth = 0,           // NEW
        userAudioPrefs = {},        // NEW
        negativeSignals = {}        // NEW
    } = options;

    const authorIds = [...new Set(reels.map(r => (r.user?._id || r.user || r.author?._id || r.author).toString()))];
    let affinityCache = new Map();
    const followingSet = new Set(followingIds.map(String));
    if (userId) affinityCache = await UserEngagement.getBatchAffinities(userId, authorIds);

    // Negative signal sets
    const skippedCreators = new Set((negativeSignals.skippedCreators || []).map(String));
    const hiddenCategories = new Set((negativeSignals.hiddenCategories || []).map(s => s.toLowerCase()));

    // One aggregation for all reels instead of one count query per reel
    let velocityMap = null;
    if (includeVelocity) {
        velocityMap = await Like.getBatchLikeVelocities('reel', reels.map(r => r._id), CONFIG.VELOCITY_WINDOW_HOURS);
    }

    const scored = await Promise.all(reels.map(async reel => {
        const authorId = (reel.user?._id || reel.user || reel.author?._id || reel.author)?.toString();
        const author = reel.user || reel.author || {};

        let score = calculateEngagementScore(reel);
        score = applyTimeDecay(score, reel.createdAt);
        score *= getFreshnessBoost(reel.createdAt);

        if (velocityMap) score += (velocityMap.get(reel._id.toString()) || 0) * CONFIG.VELOCITY_WEIGHT;

        score += getPersonalizationBoost(userId, authorId, affinityCache, followingSet);
        score += getCreatorScore(author);

        // Audio affinity (NEW)
        score += getAudioBoost(reel, userAudioPrefs);

        // Creator cold start (NEW)
        score += getCreatorColdStartBoost(author);

        // Negative signals (NEW)
        if (authorId && skippedCreators.has(authorId)) {
            score *= CONFIG.NEGATIVE.SKIP_PENALTY;
        }
        const reelCat = (reel.category || reel.vibe || '').toLowerCase();
        if (reelCat && hiddenCategories.has(reelCat)) {
            score *= CONFIG.NEGATIVE.HIDE_PENALTY;
        }

        return { ...reel, _score: score, _personalBoost: getPersonalizationBoost(userId, authorId, affinityCache, followingSet) };
    }));

    scored.sort((a, b) => b._score - a._score);

    // Positional passes AFTER the single sort — category diversity defines the
    // final order, so no re-sort afterwards (the old final sort undid it)
    let result = enforceCategoryDiversity(scored);

    // Session pacing — metadata/score tagging on final positions
    result = applyReelSessionPacing(result, sessionDepth);

    // Diversity injection
    if (injectDiversityContent && reels.length > 10) {
        return injectDiversity(result, reels);
    }

    return result;
}

async function getForYouFeed(userId, reels, options = {}) {
    const others = reels.filter(r => (r.user?._id || r.user || r.author?._id || r.author)?.toString() !== userId?.toString());
    const discovery = others.length >= 5 ? others : reels;
    return rankReels(discovery, userId, { ...options, injectDiversityContent: true });
}

async function getFollowingFeed(userId, reels, followingIds) {
    const followingSet = new Set(followingIds.map(String));
    const followed = reels.filter(r => {
        const aid = (r.user?._id || r.user || r.author?._id || r.author)?.toString();
        return followingSet.has(aid) || aid === userId?.toString();
    });
    return rankReels(followed, userId, { includeVelocity: false, injectDiversityContent: false, followingIds });
}

module.exports = {
    calculateEngagementScore, applyTimeDecay, getFreshnessBoost,
    getPersonalizationBoost, getCreatorScore, calculateVelocity,
    rankReels, getForYouFeed, getFollowingFeed, injectDiversity,
    // NEW exports
    getAudioBoost, getCreatorColdStartBoost,
    applyReelSessionPacing, enforceCategoryDiversity,
    CONFIG
};

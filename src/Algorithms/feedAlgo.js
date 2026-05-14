/**
 * feedAlgo v2.0 — Production-Grade Post Feed Ranking
 * Upgrades: Engagement feedback loop, content fatigue, negative signals,
 * cold start, author diversity, quality gate
 * Exports are 100% backward-compatible.
 */
const UserEngagement = require('../models/UserEngagement');
const UserBehavior = require('../models/UserBehavior');
const Like = require('../models/Like');
const InterestProfiler = require('./InterestProfiler');
const VibeClassifier = require('./VibeClassifier');

const CONFIG = {
    HALF_LIFE_HOURS: 36, MAX_AGE_HOURS: 168,  // 36h half-life, 7-day max (was 12h / 72h)
    WEIGHTS: { likes: 1.0, comments: 3.0, shares: 4.0, retweets: 5.0, quotes: 4.5, bookmarks: 2.0, views: 0.05, replies: 2.5 },
    PERSONALIZATION_WEIGHT: 0.6, FOLLOW_BOOST: 1.8, MUTUAL_FOLLOW_BOOST: 2.2, INTEREST_MATCH_BOOST: 2.5,
    MEDIA_BOOST: { image: 1.1, video: 1.3, gif: 1.05, text_only: 1.0 },
    TRENDING_HASHTAG_BOOST: 1.5, VELOCITY_WINDOW_HOURS: 0.5, VELOCITY_WEIGHT: 3.0,
    VRR: { HIGH_ENGAGEMENT: 0.55, DISCOVERY: 0.30, WILDCARD: 0.15 },
    SESSION_PACING: { EARLY_BOOST: 1.3, MID_DIP: 0.9, LATE_SPIKE: 1.2, EARLY_THRESHOLD: 5, MID_THRESHOLD: 15 },  // gentler pacing
    SOCIAL_PROOF: { FRIEND_LIKE_BOOST: 0.8, MAX_FRIEND_BOOST: 3.0, MIN_FRIENDS_SHOW: 1 },  // show with 1 friend like (was 2)
    CURIOSITY: { INJECTION_RATE: 0.1, TRENDING_BOOST: 1.5, CONTROVERSIAL_BOOST: 1.2 },  // toned down
    FRESHNESS: { NEW_CONTENT_BOOST: 1.3, SEEN_PENALTY: 0.7 },  // seen posts keep 70% score (was 30%)
    // v2 additions — eased for early-stage growth
    FATIGUE: { MAX_SAME_AUTHOR_IN_BATCH: 5, TOPIC_SATURATION_THRESHOLD: 0.7, TOPIC_FATIGUE_PENALTY: 0.8 },  // much more lenient
    NEGATIVE_SIGNALS: { SKIP_PENALTY: 0.85, HIDE_PENALTY: 0.5, UNFOLLOW_AUTHOR_PENALTY: 0.3 },  // softer penalties
    COLD_START: { MIN_INTERACTIONS: 30, TRENDING_WEIGHT: 2.0, VERIFIED_BOOST: 1.4 },  // less aggressive cold start
    QUALITY_GATE: { MIN_ENGAGEMENT_OLD_POSTS: 1, OLD_POST_AGE_HOURS: 120 },  // filter zero-engagement posts older than 5 days
    FEEDBACK: { POSITIVE_BOOST: 1.2, NEGATIVE_DAMPEN: 0.8 }  // gentler feedback loop
};

// ── Core Scoring ──
function calculatePostScore(post) {
    const stats = post.stats || {};
    let score = (stats.likes || post.likes?.length || 0) * CONFIG.WEIGHTS.likes
        + (stats.comments || 0) * CONFIG.WEIGHTS.comments
        + (stats.shares || 0) * CONFIG.WEIGHTS.shares
        + (stats.views || 0) * CONFIG.WEIGHTS.views;
    score *= CONFIG.MEDIA_BOOST[getMediaType(post)] || 1.0;
    return score;
}

function getMediaType(post) {
    const media = post.content?.media || [];
    if (media.length === 0) return 'text_only';
    const types = media.map(m => m.type);
    if (types.includes('video')) return 'video';
    if (types.includes('gif')) return 'gif';
    if (types.includes('image')) return 'image';
    return 'text_only';
}

function applyTimeDecay(score, createdAt) {
    const hoursAge = (Date.now() - new Date(createdAt).getTime()) / 3600000;
    if (hoursAge > CONFIG.MAX_AGE_HOURS) return score * 0.005;
    return score * Math.pow(0.5, hoursAge / CONFIG.HALF_LIFE_HOURS);
}

async function getTrendingVelocity(postId) {
    return (await Like.getLikeVelocity('post', postId, CONFIG.VELOCITY_WINDOW_HOURS)) * CONFIG.VELOCITY_WEIGHT;
}

function getHashtagBoost(post, trendingHashtags = []) {
    const tags = post.content?.hashtags || [];
    if (!tags.length) return 0;
    const trendSet = new Set(trendingHashtags.map(h => h.toLowerCase()));
    return tags.filter(h => trendSet.has(h.toLowerCase())).length * CONFIG.TRENDING_HASHTAG_BOOST;
}

// ── VRR / Session / Social ──
function assignVRRCategory(post, userRelevance) {
    const combined = userRelevance * 0.6 + (Math.log10(calculatePostScore(post) + 1) / 5) * 0.4;
    return combined > 0.7 ? 'HIGH' : combined > 0.4 ? 'DISCOVERY' : 'WILDCARD';
}

function applyVRRDistribution(scoredPosts, userBehavior) {
    if (scoredPosts.length < 10) return scoredPosts;
    const hi = scoredPosts.filter(p => p._vrrCategory === 'HIGH');
    const disc = scoredPosts.filter(p => p._vrrCategory === 'DISCOVERY');
    const wild = scoredPosts.filter(p => p._vrrCategory === 'WILDCARD');
    const len = scoredPosts.length;
    const hc = Math.floor(len * CONFIG.VRR.HIGH_ENGAGEMENT);
    const dc = Math.floor(len * CONFIG.VRR.DISCOVERY);
    const result = [...hi.slice(0, hc), ...disc.slice(0, dc), ...wild.slice(0, len - hc - dc)];
    return shuffleWithBias(result, hi.slice(0, 3));
}

function shuffleWithBias(posts, topPosts) {
    const result = [...posts];
    const topIds = new Set(topPosts.map(p => (p._id || p).toString()));
    for (let i = result.length - 1; i > 0; i--) {
        if (topIds.has((result[i]._id || result[i]).toString())) continue;
        const j = Math.floor(Math.random() * (i + 1));
        if (topIds.has((result[j]._id || result[j]).toString())) continue;
        [result[i], result[j]] = [result[j], result[i]];
    }
    if (topPosts.length > 0) {
        const hi = result.findIndex(p => (p._id || p).toString() === (topPosts[0]._id || topPosts[0]).toString());
        if (hi > 0) [result[0], result[hi]] = [result[hi], result[0]];
    }
    return result;
}

function applySessionPacing(posts, sessionDepth) {
    return posts.map((post, i) => {
        const pos = sessionDepth + i;
        const m = pos < CONFIG.SESSION_PACING.EARLY_THRESHOLD ? CONFIG.SESSION_PACING.EARLY_BOOST
            : pos < CONFIG.SESSION_PACING.MID_THRESHOLD ? CONFIG.SESSION_PACING.MID_DIP
                : CONFIG.SESSION_PACING.LATE_SPIKE;
        return { ...post, _score: (post._score || 0) * m, _pacingPhase: pos < 5 ? 'early' : pos < 15 ? 'mid' : 'late' };
    });
}

async function applySocialProof(posts, userId, friendIds = []) {
    if (!friendIds?.length) return posts;
    const postIds = posts.map(p => (p._id || p).toString());
    const friendLikes = await Like.find({ user: { $in: friendIds }, targetType: 'post', targetId: { $in: postIds } }).select('targetId user').lean();
    const map = new Map();
    friendLikes.forEach(l => { const pid = l.targetId.toString(); const c = map.get(pid) || { count: 0, friends: [] }; c.count++; c.friends.push(l.user.toString()); map.set(pid, c); });
    return posts.map(post => {
        const d = map.get((post._id || post).toString());
        if (d && d.count >= CONFIG.SOCIAL_PROOF.MIN_FRIENDS_SHOW) {
            const boost = Math.min(d.count * CONFIG.SOCIAL_PROOF.FRIEND_LIKE_BOOST, CONFIG.SOCIAL_PROOF.MAX_FRIEND_BOOST);
            return { ...post, _score: (post._score || 0) * (1 + boost), _friendsLiked: d.count, _socialProofBoost: boost };
        }
        return post;
    });
}

function injectCuriosityGaps(posts, seenTopics = new Set()) {
    return posts.map(post => {
        let cb = 0;
        for (const t of InterestProfiler.extractTopics(post)) { if (!seenTopics.has(t)) cb += 0.3; }
        const s = post.stats || {};
        if ((s.comments || 0) / (s.likes || 1) > 0.15) cb += CONFIG.CURIOSITY.CONTROVERSIAL_BOOST;
        return { ...post, _score: (post._score || 0) + cb, _curiosityBoost: cb };
    });
}

function applyFreshness(posts, seenPostIds) {
    return posts.map(post => {
        const seen = seenPostIds.has((post._id || post).toString());
        return { ...post, _score: (post._score || 0) * (seen ? CONFIG.FRESHNESS.SEEN_PENALTY : CONFIG.FRESHNESS.NEW_CONTENT_BOOST), _isSeen: seen };
    });
}

// ── v2.0 NEW Features ──
function applyContentFatigue(posts) {
    if (posts.length < 5) return posts;
    const topicCounts = {}, authorCounts = {};
    return posts.map(post => {
        let fm = 1.0;
        const aid = (post.author?._id || post.author)?.toString();
        if (aid) { authorCounts[aid] = (authorCounts[aid] || 0) + 1; if (authorCounts[aid] > CONFIG.FATIGUE.MAX_SAME_AUTHOR_IN_BATCH) fm *= 0.5; }
        for (const t of InterestProfiler.extractTopics(post)) {
            topicCounts[t] = (topicCounts[t] || 0) + 1;
            if (topicCounts[t] / posts.length > CONFIG.FATIGUE.TOPIC_SATURATION_THRESHOLD) { fm *= CONFIG.FATIGUE.TOPIC_FATIGUE_PENALTY; break; }
        }
        return { ...post, _score: (post._score || 0) * fm, _fatiguePenalty: fm < 1 ? fm : null };
    });
}

function enforceAuthorDiversity(posts) {
    if (posts.length < 3) return posts;
    const result = [], deferred = [];
    for (const post of posts) {
        const aid = (post.author?._id || post.author)?.toString();
        const prev = result.length > 0 ? (result[result.length - 1].author?._id || result[result.length - 1].author)?.toString() : null;
        const prev2 = result.length > 1 ? (result[result.length - 2].author?._id || result[result.length - 2].author)?.toString() : null;
        if (aid && aid === prev && aid === prev2) deferred.push(post); else result.push(post);
    }
    for (const post of deferred) {
        let ins = false;
        for (let i = 2; i < result.length; i++) {
            if ((result[i - 1].author?._id || result[i - 1].author)?.toString() !== (post.author?._id || post.author)?.toString()) { result.splice(i, 0, post); ins = true; break; }
        }
        if (!ins) result.push(post);
    }
    return result;
}

function applyNegativeSignals(posts, signals = {}) {
    if (!signals || !Object.keys(signals).length) return posts;
    const { skippedAuthors = [], hiddenTopics = [], unfollowedAuthors = [] } = signals;
    const skipSet = new Set(skippedAuthors.map(String)), unfSet = new Set(unfollowedAuthors.map(String)), hidSet = new Set(hiddenTopics.map(t => t.toLowerCase()));
    return posts.map(post => {
        let m = 1.0; const aid = (post.author?._id || post.author)?.toString();
        if (aid && unfSet.has(aid)) m *= CONFIG.NEGATIVE_SIGNALS.UNFOLLOW_AUTHOR_PENALTY;
        else if (aid && skipSet.has(aid)) m *= CONFIG.NEGATIVE_SIGNALS.SKIP_PENALTY;
        for (const t of InterestProfiler.extractTopics(post)) { if (hidSet.has(t)) { m *= CONFIG.NEGATIVE_SIGNALS.HIDE_PENALTY; break; } }
        return { ...post, _score: (post._score || 0) * m, _negativePenalty: m < 1 ? m : null };
    });
}

function applyQualityGate(posts) {
    return posts.filter(post => {
        // Never filter out anonymous posts
        if (post.isAnonymous) return true;
        const hrs = (Date.now() - new Date(post.createdAt).getTime()) / 3600000;
        if (hrs < CONFIG.QUALITY_GATE.OLD_POST_AGE_HOURS) return true;
        const s = post.stats || {};
        return ((s.likes || post.likes?.length || 0) + (s.comments || 0) + (s.shares || 0)) >= CONFIG.QUALITY_GATE.MIN_ENGAGEMENT_OLD_POSTS;
    });
}

function applyEngagementFeedback(posts, fb = {}) {
    if (!fb.likedTopics && !fb.skippedTopics) return posts;
    const liked = new Set(fb.likedTopics || []), skipped = new Set(fb.skippedTopics || []);
    return posts.map(post => {
        let m = 1.0;
        for (const t of InterestProfiler.extractTopics(post)) {
            if (liked.has(t)) { m *= CONFIG.FEEDBACK.POSITIVE_BOOST; break; }
            if (skipped.has(t)) { m *= CONFIG.FEEDBACK.NEGATIVE_DAMPEN; break; }
        }
        return { ...post, _score: (post._score || 0) * m, _feedbackAdjustment: m !== 1 ? m : null };
    });
}

function applyColdStartBoost(posts, isCold) {
    if (!isCold) return posts;
    return posts.map(post => {
        let b = 1.0; const a = post.author || {};
        if (a.isVerified) b *= CONFIG.COLD_START.VERIFIED_BOOST;
        const eng = (post.stats?.likes || 0) + (post.stats?.comments || 0) * 2;
        if (eng > 50) b *= 1.2; if (eng > 200) b *= 1.3;
        const hrs = (Date.now() - new Date(post.createdAt).getTime()) / 3600000;
        if (hrs < 12) b *= 1.2;
        return { ...post, _score: (post._score || 0) * b, _coldStartBoost: b > 1 ? b : null };
    });
}

// ── Main Ranking ──
async function rankPosts(posts, userId, options = {}) {
    if (!posts?.length) return [];
    const { followingIds = [], mutualIds = [], friendIds = [], trendingHashtags = [], includeVelocity = true, negativeSignals = {}, recentFeedback = {} } = options;
    let userBehavior = null, sessionDepth = 0, seenPostIds = new Set(), isColdStart = false;
    if (userId) { try { userBehavior = await UserBehavior.getPreferences(userId); sessionDepth = userBehavior.sessionDepth || 0; seenPostIds = await UserBehavior.getSeenPostIds(userId, 24); isColdStart = (userBehavior.totalInteractions || 0) < CONFIG.COLD_START.MIN_INTERACTIONS; } catch (e) { isColdStart = true; } } else { isColdStart = true; }
    const authorIds = [...new Set(posts.map(p => (p.author?._id || p.author).toString()))];
    let affinityCache = new Map(); const followingSet = new Set(followingIds.map(String)), mutualSet = new Set(mutualIds.map(String));
    if (userId) affinityCache = await UserEngagement.getBatchAffinities(userId, authorIds);
    let qualityPosts = applyQualityGate(posts);
    const scored = await Promise.all(qualityPosts.map(async post => {
        const aid = (post.author?._id || post.author)?.toString();
        let score = applyTimeDecay(calculatePostScore(post), post.createdAt);
        if (includeVelocity) score += await getTrendingVelocity(post._id);
        score += getHashtagBoost(post, trendingHashtags);
        score += (affinityCache?.get(aid) || 0) * CONFIG.PERSONALIZATION_WEIGHT;
        if (mutualSet?.has(aid)) score *= CONFIG.MUTUAL_FOLLOW_BOOST; else if (followingSet?.has(aid)) score *= CONFIG.FOLLOW_BOOST;
        let rel = 5.0; if (userId && userBehavior) { rel = await InterestProfiler.getRelevanceScore(post, userId, userBehavior); score += rel * CONFIG.INTEREST_MATCH_BOOST; }
        return { ...post, _score: score, _relevanceScore: rel, _vrrCategory: assignVRRCategory(post, rel / 10) };
    }));
    let ranked = scored;
    ranked = applyFreshness(ranked, seenPostIds);
    ranked = injectCuriosityGaps(ranked, new Set((userBehavior?.topics || new Map()).keys?.() || []));
    if (friendIds?.length) ranked = await applySocialProof(ranked, userId, friendIds);
    ranked = applyContentFatigue(ranked);
    ranked = applyNegativeSignals(ranked, negativeSignals);
    ranked = applyEngagementFeedback(ranked, recentFeedback);
    ranked = applyColdStartBoost(ranked, isColdStart);
    ranked.sort((a, b) => b._score - a._score);
    ranked = applyVRRDistribution(ranked, userBehavior);
    ranked = applySessionPacing(ranked, sessionDepth);
    ranked = enforceAuthorDiversity(ranked);
    ranked.sort((a, b) => b._score - a._score);
    return ranked;
}

async function getTrendingPosts(posts, options = {}) {
    const { timeRange = 6, limit = 20 } = options;
    const cutoff = new Date(Date.now() - timeRange * 3600000);
    const recent = posts.filter(p => new Date(p.createdAt) >= cutoff);
    const wv = await Promise.all(recent.map(async p => ({ ...p, _velocity: await getTrendingVelocity(p._id), _engagementScore: calculatePostScore(p) })));
    wv.sort((a, b) => (b._velocity - a._velocity) || b._engagementScore - a._engagementScore);
    return wv.slice(0, limit);
}

async function getForYouFeed(userId, posts, options = {}) {
    return rankPosts(posts.filter(p => (p.author?._id || p.author)?.toString() !== userId?.toString()), userId, options);
}

// ── Vibe filtering ──
function classifyPostVibes(posts) {
    return posts.map(post => {
        if (post.vibe && post.vibe !== 'general') return post;
        const c = VibeClassifier.classify(post);
        return { ...post, vibe: c.vibe, vibeScore: c.vibeScore, _vibeConfidence: c.confidence };
    });
}
function filterByVibe(posts, vibe) {
    if (!vibe || vibe === 'auto') return posts;
    return posts.filter(p => p.vibe === vibe || (p.vibeScore && p.vibeScore[vibe] > 1.5) || VibeClassifier.classify(p).vibe === vibe);
}
async function rankPostsWithVibe(posts, userId, options = {}) {
    const { vibe = 'auto', ...rest } = options;
    let cp = classifyPostVibes(posts);
    if (vibe && vibe !== 'auto') { cp = filterByVibe(cp, vibe); cp = VibeClassifier.boostByVibe(cp, vibe, 1.5); }
    return rankPosts(cp, userId, rest);
}

module.exports = {
    calculatePostScore, applyTimeDecay, getTrendingVelocity, getHashtagBoost,
    assignVRRCategory, applyVRRDistribution, applySessionPacing, applySocialProof,
    injectCuriosityGaps, applyFreshness, rankPosts, rankPostsWithVibe,
    getTrendingPosts, getForYouFeed, getMediaType, classifyPostVibes, filterByVibe,
    applyContentFatigue, enforceAuthorDiversity, applyNegativeSignals,
    applyQualityGate, applyEngagementFeedback, applyColdStartBoost, CONFIG
};

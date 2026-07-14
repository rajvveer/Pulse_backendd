/**
 * feedAlgo — C++-accelerated wrapper (post feed ranking).
 *
 * Public API unchanged (rankPosts, rankPostsWithVibe, getTrendingPosts,
 * getForYouFeed, + all helper exports). rankPosts gathers the same DB-derived
 * signals the original did (velocity map, author affinity, friend likes, seen
 * posts, user behavior), then runs the heavy ranking pipeline in the native
 * addon. If the addon isn't built — or anything goes wrong — it falls back to
 * the pure-JS implementation, so results are always produced.
 */
const UserEngagement = require('../models/UserEngagement');
const UserBehavior = require('../models/UserBehavior');
const Like = require('../models/Like');
const InterestProfiler = require('./InterestProfiler');
const VibeClassifier = require('./VibeClassifier');
const { addon } = require('../../native');
const JS = require('./_fallback/feedAlgo');
const { msFields } = require('./_nativeUtil');
const trustService = require('../services/trustService');

const aid = (p) => (p.author?._id || p.author)?.toString();

async function rankPosts(posts, userId, options = {}) {
  if (!posts?.length) return [];
  if (!addon) return JS.rankPosts(posts, userId, options);

  try {
    const {
      followingIds = [], mutualIds = [], friendIds = [], trendingHashtags = [],
      includeVelocity = true,
    } = options;

    // ── Gather DB-derived signals (same as the JS impl) ──
    let userBehavior = null, sessionDepth = 0, seenPostIds = new Set(), isColdStart = false;
    if (userId) {
      try {
        userBehavior = await UserBehavior.getPreferences(userId);
        sessionDepth = userBehavior.sessionDepth || 0;
        seenPostIds = await UserBehavior.getSeenPostIds(userId, 24);
        isColdStart = (userBehavior.totalInteractions || 0) < JS.CONFIG.COLD_START.MIN_INTERACTIONS;
      } catch (_) { isColdStart = true; }
    } else {
      isColdStart = true;
    }

    const authorIds = [...new Set(posts.map(aid).filter(Boolean))];
    const affinityCacheMap = userId ? await UserEngagement.getBatchAffinities(userId, authorIds) : new Map();
    const affinityMap = {};
    for (const [k, v] of affinityCacheMap) affinityMap[k] = v;

    // Velocity for all candidates in one aggregation.
    let velocityMap = {};
    if (includeVelocity) {
      const vMap = await Like.getBatchLikeVelocities('post', posts.map(p => p._id), JS.CONFIG.VELOCITY_WINDOW_HOURS);
      for (const [k, v] of vMap) velocityMap[k] = v;
    }

    // Friend likes (social proof) — one query, counted per post.
    const friendLikes = {};
    if (friendIds?.length) {
      const postIds = posts.map(p => (p._id || p).toString());
      const likes = await Like.find({
        user: { $in: friendIds }, targetType: 'post', targetId: { $in: postIds },
      }).select('targetId').lean();
      for (const l of likes) {
        const pid = l.targetId.toString();
        friendLikes[pid] = (friendLikes[pid] || 0) + 1;
      }
    }

    // Per-post relevance (interest profiler) — batch via its kernel.
    const relevanceMap = {};
    if (userId && userBehavior) {
      try {
        const scored = await InterestProfiler.batchScorePosts(posts, userId);
        for (const s of scored) relevanceMap[(s._id || s).toString()] = s._relevanceScore;
      } catch (_) { /* relevance optional */ }
    }

    // Integrity signals: author trust (cached) + per-post engagement-bait.
    let trustMap = {}, baitMap = {};
    try {
      ({ trustMap, baitMap } = await trustService.buildSignals(posts));
    } catch (_) { /* integrity is best-effort; ranking still works without it */ }

    const payload = {
      posts: msFields(posts, ['createdAt']),
      userId: userId ? userId.toString() : null,
      nowMs: Date.now(),
      trustMap, baitMap,
      followingIds: followingIds.map(String),
      mutualIds: mutualIds.map(String),
      friendIds: friendIds.map(String),
      trendingHashtags,
      velocityMap, affinityMap, friendLikes, relevanceMap,
      seenPostIds: [...seenPostIds],
      isColdStart, sessionDepth,
    };

    return JSON.parse(addon.feedRank(JSON.stringify(payload)));
  } catch (err) {
    console.warn('[feedAlgo] native path failed, using JS fallback:', err.message);
    return JS.rankPosts(posts, userId, options);
  }
}

async function rankPostsWithVibe(posts, userId, options = {}) {
  const { vibe = 'auto', ...rest } = options;
  let cp = posts.map(post => {
    if (post.vibe && post.vibe !== 'general') return post;
    const c = VibeClassifier.classify(post);
    return { ...post, vibe: c.vibe, vibeScore: c.vibeScore, _vibeConfidence: c.confidence };
  });
  if (vibe && vibe !== 'auto') {
    cp = cp.filter(p => p.vibe === vibe || (p.vibeScore && p.vibeScore[vibe] > 1.5));
    cp = VibeClassifier.boostByVibe(cp, vibe, 1.5);
  }
  return rankPosts(cp, userId, rest);
}

async function getForYouFeed(userId, posts, options = {}) {
  const filtered = posts.filter(p => aid(p) !== userId?.toString());
  return rankPosts(filtered, userId, options);
}

// getTrendingPosts is light (one batch velocity query + sort) — delegate to JS.
async function getTrendingPosts(posts, options = {}) {
  return JS.getTrendingPosts(posts, options);
}

module.exports = {
  rankPosts,
  rankPostsWithVibe,
  getForYouFeed,
  getTrendingPosts,
  // Pure helpers / config straight from JS impl (unchanged behavior).
  calculatePostScore: JS.calculatePostScore,
  applyTimeDecay: JS.applyTimeDecay,
  getTrendingVelocity: JS.getTrendingVelocity,
  getHashtagBoost: JS.getHashtagBoost,
  assignVRRCategory: JS.assignVRRCategory,
  applyVRRDistribution: JS.applyVRRDistribution,
  applySessionPacing: JS.applySessionPacing,
  applySocialProof: JS.applySocialProof,
  injectCuriosityGaps: JS.injectCuriosityGaps,
  applyFreshness: JS.applyFreshness,
  getMediaType: JS.getMediaType,
  classifyPostVibes: JS.classifyPostVibes,
  filterByVibe: JS.filterByVibe,
  applyContentFatigue: JS.applyContentFatigue,
  enforceAuthorDiversity: JS.enforceAuthorDiversity,
  applyNegativeSignals: JS.applyNegativeSignals,
  applyQualityGate: JS.applyQualityGate,
  applyEngagementFeedback: JS.applyEngagementFeedback,
  applyColdStartBoost: JS.applyColdStartBoost,
  CONFIG: JS.CONFIG,
};

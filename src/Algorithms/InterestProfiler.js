/**
 * InterestProfiler — C++-accelerated wrapper.
 *
 * Keeps the full public API. DB-bound entry points (getRelevanceScore,
 * batchScorePosts) fetch UserBehavior prefs in JS, then run the pure relevance
 * scoring in the native addon when built (falling back to JS otherwise). The
 * lightweight pure helpers (extractTopics, getMediaType, etc.) stay in JS since
 * feedAlgo imports them directly and they are cheap.
 */
const { addon } = require('../../native');
const JS = require('./_fallback/InterestProfiler');
const UserBehavior = require('../models/UserBehavior');

// Convert a prefs object (topics may be a Mongo Map or plain object) into the
// plain-JSON shape the C++ kernel expects.
function normalizePrefs(prefs) {
  const topics = {};
  const t = prefs?.topics;
  if (t instanceof Map) for (const [k, v] of t) topics[k] = v;
  else if (t && typeof t === 'object') Object.assign(topics, t);

  const authorAffinities = {};
  const aa = prefs?.authorAffinities;
  if (aa instanceof Map) for (const [k, v] of aa) authorAffinities[k] = v;
  else if (aa && typeof aa === 'object') Object.assign(authorAffinities, aa);

  return {
    topics,
    mediaTypes: prefs?.mediaTypes || {},
    postLengths: prefs?.postLengths || {},
    authorAffinities: Object.keys(authorAffinities).length ? authorAffinities : null,
  };
}

async function getRelevanceScore(post, userId, userPrefs = null) {
  if (!post || !userId) return 1.0;
  const prefs = userPrefs || await UserBehavior.getPreferences(userId);

  if (addon) {
    try {
      const payload = { posts: [post], prefs: normalizePrefs(prefs) };
      const res = JSON.parse(addon.interestScore(JSON.stringify(payload)));
      if (Array.isArray(res) && res.length) return res[0].relevance;
    } catch (_) { /* fall through */ }
  }
  return JS.getRelevanceScore(post, userId, prefs);
}

async function batchScorePosts(posts, userId) {
  if (!posts || posts.length === 0) return posts;
  const prefs = await UserBehavior.getPreferences(userId);
  const seenIds = await UserBehavior.getSeenPostIds(userId, 24);

  if (addon) {
    try {
      const payload = { posts, prefs: normalizePrefs(prefs) };
      const scored = JSON.parse(addon.interestScore(JSON.stringify(payload)));
      const byId = new Map(scored.map(s => [s.postId, s.relevance]));
      return posts.map(post => {
        const id = (post._id || post).toString();
        let rel = byId.get(id) ?? 1.0;
        if (seenIds.has(id)) rel *= JS.CONFIG.SEEN_PENALTY;
        return { ...post, _relevanceScore: rel, _isSeen: seenIds.has(id) };
      });
    } catch (_) { /* fall through */ }
  }
  return JS.batchScorePosts(posts, userId);
}

// Pure helpers + config pass straight through to the JS impl (cheap; imported
// by feedAlgo). The native kernel mirrors extractTopics internally for its own
// scoring, so behavior stays consistent.
module.exports = {
  getRelevanceScore,
  batchScorePosts,
  extractTopics: JS.extractTopics,
  calculateTopicMatch: JS.calculateTopicMatch,
  calculateNichenessBoost: JS.calculateNichenessBoost,
  calculateCrossTopicBoost: JS.calculateCrossTopicBoost,
  getMediaType: JS.getMediaType,
  getPostLengthKey: JS.getPostLengthKey,
  getTopInterests: JS.getTopInterests,
  TOPIC_PATTERNS: JS.TOPIC_PATTERNS,
  CROSS_TOPIC_AFFINITIES: JS.CROSS_TOPIC_AFFINITIES,
  CONFIG: JS.CONFIG,
};

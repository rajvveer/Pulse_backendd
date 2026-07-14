'use strict';
/**
 * Ranker adapters for the eval harness.
 *
 * These expose the SAME signature — (user, candidates, ctx) => orderedPosts —
 * so the runner can score any of them on identical data. The important one is
 * `nativeFeed`, which calls the real C++ feed kernel (the production ranker)
 * with signal maps derived from the synthetic dataset. Baselines (recency,
 * engagement) establish the floor a good ranker must beat.
 */
const { addon } = require('../../native');
const embeddingService = require('../../src/services/embeddingService');
const vectorRetrieval = require('../../src/services/vectorRetrievalService');
const trustService = require('../../src/services/trustService');

// ── Baselines ──
const recency = (user, candidates) =>
  [...candidates].sort((a, b) => b.createdAt - a.createdAt);

const engagement = (user, candidates) =>
  [...candidates].sort((a, b) => (b.stats.likes || 0) - (a.stats.likes || 0));

// Derive the signal maps the C++ feed kernel expects from the dataset.
// (In production these come from Mongo/Redis; here we synthesize them so the
//  SAME kernel runs against ground-truth data.)
function buildFeedPayload(user, candidates, now) {
  const velocityMap = {};
  const affinityMap = {};
  const friendLikes = {};
  // Integrity signals computed synchronously from the (in-memory) candidates —
  // mirrors trustService.buildSignals but without the Redis cache for the eval.
  const trustMap = {};
  const baitMap = {};
  for (const p of candidates) {
    // velocity ≈ recent like rate proxy
    velocityMap[p._id] = (p.stats.likes || 0) / 100;
    // affinity ≈ stronger for authors the user follows
    const aid = p.author._id;
    if (!(aid in affinityMap)) affinityMap[aid] = user.following.includes(aid) ? 0.8 : 0.1;
    if (!(aid in trustMap)) trustMap[aid] = trustService.computeAuthorTrust(p.author);
    baitMap[p._id] = trustService.baitPenalty(p);
  }
  return {
    trustMap,
    baitMap,
    posts: candidates.map((p) => ({
      _id: p._id,
      author: { _id: p.author._id, isVerified: p.author.isVerified },
      stats: p.stats,
      content: p.content,
      createdAt: p.createdAt,
      vibe: p.vibe,
      isAnonymous: false,
    })),
    userId: user._id,
    nowMs: now,
    followingIds: user.following,
    mutualIds: [],
    friendIds: [],
    trendingHashtags: [],
    velocityMap, affinityMap, friendLikes,
    relevanceMap: {},
    seenPostIds: [],
    isColdStart: !!user.isCold,
    sessionDepth: 0,
  };
}

// The production feed ranker (C++) on the SHARED candidate window. Production
// never ranks the entire catalog — it ranks ~200 candidates from
// getCandidateSet (recent public posts). The eval mirrors that so the ranker is
// measured on a realistic input, not an artificial 1000-item pool.
const CANDIDATE_WINDOW = 200;

function nativeFeed(now) {
  return (user, candidates) => {
    if (!addon) throw new Error('native addon not built — run npm run build:native');
    // Mirror getCandidateSet: newest public window.
    const pool = [...candidates].sort((a, b) => b.createdAt - a.createdAt).slice(0, CANDIDATE_WINDOW);
    const payload = buildFeedPayload(user, pool, now);
    const ranked = JSON.parse(addon.feedRank(JSON.stringify(payload)));
    const byId = new Map(pool.map((p) => [p._id, p]));
    return ranked.map((p) => byId.get(p._id)).filter(Boolean);
  };
}

// Build a user taste vector from the posts they've engaged with. In the eval
// world we approximate "engaged" as: posts by authors they follow + a sample of
// their genuinely-relevant posts (simulating observed history, NOT ground truth
// leakage — we only use authorship/follow + observed stats, same as production
// would have from real engagement logs).
function userTasteVector(user, posts, dataset) {
  const engaged = [];
  for (const p of posts) {
    if (user.following.includes(p.author._id) && engaged.length < 25) engaged.push(p);
  }
  // Fold in vibe preference as strands.
  const vibeStrands = {}; vibeStrands[user.vibe] = 100;
  return embeddingService.userVector({ engagedPosts: engaged, vibeStrands });
}

// RETRIEVE-then-RANK: cosine candidate generation → native C++ ranking.
function retrieveThenRank(now) {
  const native = nativeFeed(now);
  return (user, candidates, ctx) => {
    const uv = userTasteVector(user, candidates, ctx.dataset);
    // Retrieve a semantically-relevant candidate pool (top 200 by cosine)
    // instead of ranking the entire recency pool.
    const pool = vectorRetrieval.rankByCosine(uv, candidates, 200);
    // Rank the retrieved pool with the production kernel.
    return native(user, pool, ctx);
  };
}

// Pure vector retrieval only (no ranker) — to isolate retrieval quality.
function vectorOnly() {
  return (user, candidates, ctx) => {
    const uv = userTasteVector(user, candidates, ctx.dataset);
    return vectorRetrieval.rankByCosine(uv, candidates, candidates.length);
  };
}

module.exports = { recency, engagement, nativeFeed, buildFeedPayload, retrieveThenRank, vectorOnly, userTasteVector };

'use strict';
/**
 * userVectorService — builds (and caches) a user's taste vector for retrieval.
 *
 * The vector lives in the SAME space as post embeddings, so cosine(userVec,
 * postVec) ≈ predicted affinity. It's assembled from real signals:
 *   - embeddings of recently LIKED posts (strongest taste signal)
 *   - SocialDNA vibe strands (chill/hype/…)
 *   - UserBehavior topic affinities
 * Cached in Redis (short TTL) because it changes slowly relative to feed loads.
 */
const embeddingService = require('./embeddingService');
const cacheService = require('./cacheService');

const TTL = parseInt(process.env.USER_VECTOR_TTL_SEC, 10) || 300;
const LIKED_SAMPLE = 30;

/**
 * @param {Object} deps  injected models so this stays test-friendly:
 *                       { Like, Post, SocialDNA, UserBehavior }
 * @returns {Promise<number[]|null>} taste vector, or null if no signal yet
 */
async function getUserVector(userId, deps) {
  const key = `uservec:${userId}`;
  try {
    const cached = await cacheService.get(key);
    if (cached && Array.isArray(cached) && cached.length === embeddingService.DIM) return cached;
  } catch { /* fall through */ }

  const vec = await buildUserVector(userId, deps);
  if (vec) {
    try { await cacheService.set(key, vec, TTL); } catch { /* best effort */ }
  }
  return vec;
}

async function buildUserVector(userId, { Like, Post, SocialDNA, UserBehavior }) {
  // 1. Recently liked posts → their embeddings are the core taste signal.
  let likedPosts = [];
  try {
    const likeIds = await Like.find({ user: userId, targetType: 'post' })
      .sort({ createdAt: -1 }).limit(LIKED_SAMPLE).select('targetId').lean();
    const ids = likeIds.map((l) => l.targetId);
    if (ids.length) {
      likedPosts = await Post.find({ _id: { $in: ids } })
        .select('content vibe vibeScore stats createdAt embedding')
        .lean();
    }
  } catch { /* optional */ }

  // 2. SocialDNA vibe strands.
  let vibeStrands = null;
  try {
    if (SocialDNA) {
      const dna = await SocialDNA.findOne({ user: userId }).select('strands').lean();
      vibeStrands = dna?.strands || null;
    }
  } catch { /* optional */ }

  // 3. UserBehavior topic affinities.
  let topicAffinities = null;
  try {
    if (UserBehavior) {
      const prefs = await UserBehavior.getPreferences(userId);
      topicAffinities = prefs?.topics || null;
    }
  } catch { /* optional */ }

  if (likedPosts.length === 0 && !vibeStrands && !topicAffinities) return null;

  return embeddingService.userVector({
    engagedPosts: likedPosts,
    vibeStrands,
    topicAffinities,
  });
}

function invalidate(userId) {
  return cacheService.del(`uservec:${userId}`).catch(() => {});
}

/**
 * Cold-start onboarding: build an immediate taste vector from the topics/vibes
 * a brand-new user explicitly picks at signup, BEFORE they have any history.
 * This makes a new user's very first feed personalized instead of pure recency.
 * Cached like a normal user vector; later real engagement reinforces it.
 *
 * @param {string[]} topics  chosen topic keys (subset of embeddingService.TOPIC_KEYS)
 * @param {string[]} vibes   chosen vibe keys (subset of embeddingService.VIBES)
 */
async function seedFromOnboarding(userId, { topics = [], vibes = [] } = {}) {
  const topicAffinities = {};
  for (const t of topics) topicAffinities[t] = 1;
  const vibeStrands = {};
  for (const v of vibes) vibeStrands[v] = 100;

  const vec = embeddingService.userVector({
    engagedPosts: [],
    topicAffinities: Object.keys(topicAffinities).length ? topicAffinities : null,
    vibeStrands: Object.keys(vibeStrands).length ? vibeStrands : null,
  });
  if (vec) {
    try { await cacheService.set(`uservec:${userId}`, vec, TTL); } catch { /* best effort */ }
  }
  return vec;
}

module.exports = { getUserVector, buildUserVector, invalidate, seedFromOnboarding };

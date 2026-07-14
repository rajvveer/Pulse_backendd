'use strict';
/**
 * feedbackService — closes the learning loop.
 *
 * When a user engages with content (like / strong view / comment), we update
 * their taste signal in real time so the NEXT feed reflects it, instead of
 * waiting for a nightly batch. Two cheap, Redis-backed moves:
 *
 *  1. Freshen the cached user taste vector by nudging it toward the engaged
 *     item's embedding (online EMA). This makes personalization feel responsive
 *     ("I liked sci-fi, now I see more") without a full recompute.
 *  2. Track per-item recent-engagement velocity in Redis (sliding counter) so
 *     the ranker can reward genuinely-rising content faster than the Mongo
 *     aggregate refresh allows.
 *
 * All best-effort: a Redis hiccup degrades to the periodic recompute, never
 * blocks the request.
 */
const cacheService = require('./cacheService');
const embeddingService = require('./embeddingService');

const USER_VEC_KEY = (u) => `uservec:${u}`;
const USER_VEC_TTL = parseInt(process.env.USER_VECTOR_TTL_SEC, 10) || 300;
// How strongly a single engagement pulls the taste vector (online learning rate).
const ALPHA = parseFloat(process.env.FEEDBACK_ALPHA) || 0.15;

const VELOCITY_KEY = (type, id) => `vel:${type}:${id}`;
const VELOCITY_TTL = parseInt(process.env.VELOCITY_TTL_SEC, 10) || 3600; // 1h window

function l2(v) {
  let s = 0; for (const x of v) s += x * x;
  const n = Math.sqrt(s); return n === 0 ? v : v.map((x) => x / n);
}

/**
 * Online-update the user's taste vector toward an engaged item's embedding.
 * @param userId
 * @param itemEmbedding  the item's feature vector (or item to embed)
 * @param weight         signal strength multiplier (like=1, comment=1.5, etc.)
 */
async function reinforceUserVector(userId, itemEmbedding, weight = 1) {
  try {
    let emb = itemEmbedding;
    if (!Array.isArray(emb)) emb = embeddingService.featureVector(itemEmbedding);
    if (!emb || emb.length !== embeddingService.DIM) return;

    const cur = await cacheService.get(USER_VEC_KEY(userId));
    let base = Array.isArray(cur) && cur.length === embeddingService.DIM
      ? cur
      : new Array(embeddingService.DIM).fill(0);

    const a = Math.min(0.5, ALPHA * weight);
    const next = base.map((x, i) => x * (1 - a) + emb[i] * a);
    await cacheService.set(USER_VEC_KEY(userId), l2(next), USER_VEC_TTL);
  } catch {
    /* best-effort — periodic rebuild will catch up */
  }
}

/**
 * Record a real-time engagement and reinforce taste. `item` should carry an
 * `embedding` (posts do) or be embeddable; for reels we compute on the fly.
 */
async function recordEngagement(userId, { item, contentType = 'post', action = 'like' }) {
  const weight = action === 'comment' ? 1.5 : action === 'share' ? 2 : action === 'view' ? 0.4 : 1;

  // 1. Reinforce taste vector.
  let emb = item?.embedding;
  if (!emb) {
    emb = contentType === 'reel'
      ? embeddingService.reelVector(item)
      : embeddingService.featureVector(item);
  }
  await reinforceUserVector(userId, emb, weight);

  // 2. Bump per-item recent velocity (atomic INCR + expire).
  try {
    await cacheService.incrementRateLimit(VELOCITY_KEY(contentType, (item._id || item).toString()), VELOCITY_TTL);
  } catch { /* ignore */ }
}

/** Read recent engagement velocity for a set of item ids (Redis MGET). */
async function getVelocities(contentType, itemIds) {
  const out = {};
  if (!itemIds || itemIds.length === 0) return out;
  try {
    const keys = itemIds.map((id) => VELOCITY_KEY(contentType, id.toString()));
    const vals = await cacheService.redis.mget(keys);
    itemIds.forEach((id, i) => { out[id.toString()] = parseInt(vals[i], 10) || 0; });
  } catch { /* degrade to empty */ }
  return out;
}

module.exports = { recordEngagement, reinforceUserVector, getVelocities };

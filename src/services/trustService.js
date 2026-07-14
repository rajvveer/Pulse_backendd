'use strict';
/**
 * trustService — integrity / anti-gaming signals for ranking.
 *
 * Produces two ranking inputs the C++ feed kernel consumes:
 *  - authorTrust ∈ [0,1]: how legitimate an author looks. Bots, sybils, and
 *    brand-new throwaway accounts score low; established, engaged-with accounts
 *    score high. Low-trust authors are down-weighted (not removed) so the feed
 *    resists engagement farming + follow rings without nuking new real users.
 *  - baitPenalty ∈ [0,1] per post: 1 = clean, lower = engagement-bait ("like if
 *    you agree", "comment X", "follow for follow", reaction-farming).
 *
 * Trust is computed from cheap, already-stored signals (no new infra) and CACHED
 * in Redis. It's intentionally conservative: it shapes ranking, it is NOT a
 * moderation/ban decision.
 */
const cacheService = require('./cacheService');

const TRUST_TTL = parseInt(process.env.TRUST_TTL_SEC, 10) || 600;

// ── Engagement-bait patterns (down-rank, don't remove) ──
const BAIT_PATTERNS = [
  /\blike (this |and )?(if|when|to)\b/i,
  /\bcomment (below| "?\w+"?|your)\b/i,
  /\bfollow (for follow|me back|4 follow|f4f)\b/i,
  /\btag (a friend|someone|\d+ (friends|people))\b/i,
  /\bshare (this |to )?(if|and|for)\b/i,
  /\b(like|share|follow) (and|to) (win|enter|get)\b/i,
  /\bdouble tap if\b/i,
  /\bswipe up\b/i,
  /\bcheck (my |the )?(bio|link in bio)\b/i,
  /\b(repost|retweet) (if|to|for)\b/i,
];

/**
 * Per-post engagement-bait penalty (pure, no DB).
 * @returns {number} 1 = clean … 0.3 = heavy bait
 */
function baitPenalty(post) {
  const text = post?.content?.text || post?.caption || '';
  if (!text) return 1;
  let hits = 0;
  for (const re of BAIT_PATTERNS) if (re.test(text)) hits++;
  if (hits === 0) return 1;
  // each pattern shaves 25%, floored so genuine content using one phrase isn't killed
  return Math.max(0.3, 1 - hits * 0.25);
}

/**
 * Compute an author's trust score from stored signals.
 * @param {Object} author  user doc/lean with { stats, createdAt, isVerified, ... }
 * @returns {number} 0..1
 */
function computeAuthorTrust(author) {
  if (!author) return 0.5;
  if (author.isVerified) return 1.0; // verified = trusted floor

  const stats = author.stats || {};
  const followers = stats.followers || 0;
  const following = stats.following || 0;
  const posts = stats.posts || 0;
  const ageDays = author.createdAt ? (Date.now() - new Date(author.createdAt).getTime()) / 86400000 : 0;

  let trust = 0.5; // neutral prior

  // Account maturity (older = more trustworthy, saturating).
  trust += Math.min(0.2, ageDays / 90 * 0.2);

  // Real audience: having followers that engage. Log-scaled.
  if (followers > 0) trust += Math.min(0.2, Math.log10(followers + 1) / 5 * 0.2);

  // Follow-ring / spam signal: following WAY more than followers with little
  // content is classic bot/farm behavior.
  if (following > 50 && followers > 0) {
    const ratio = following / (followers + 1);
    if (ratio > 10) trust -= 0.25;
    else if (ratio > 5) trust -= 0.12;
  }
  // Following thousands while posting nothing → almost certainly a bot.
  if (following > 500 && posts < 3) trust -= 0.25;

  // Brand-new account with an enormous follower count = bought followers.
  if (ageDays < 7 && followers > 5000) trust -= 0.2;

  return Math.max(0, Math.min(1, trust));
}

/** Cached author-trust lookup. */
async function getAuthorTrust(author) {
  const id = (author?._id || author)?.toString();
  if (!id) return 0.5;
  const key = `trust:${id}`;
  try {
    const cached = await cacheService.get(key);
    if (cached !== null && typeof cached === 'number') return cached;
  } catch { /* fall through */ }

  const t = computeAuthorTrust(author);
  try { await cacheService.set(key, t, TRUST_TTL); } catch { /* best effort */ }
  return t;
}

/**
 * Build a trustMap + baitMap for a candidate set, for the ranker. Trust is read
 * from cache where possible; bait is computed inline (cheap regex).
 * @returns {Promise<{trustMap, baitMap}>}
 */
async function buildSignals(candidates) {
  const trustMap = {};
  const baitMap = {};
  // Dedup authors so we compute/cache trust once per author per request.
  const authorById = new Map();
  for (const c of candidates) {
    const a = c.author || c.user || {};
    const aid = (a._id || a)?.toString();
    if (aid && !authorById.has(aid)) authorById.set(aid, a);
    baitMap[(c._id || c).toString()] = baitPenalty(c);
  }
  await Promise.all([...authorById.entries()].map(async ([aid, a]) => {
    trustMap[aid] = await getAuthorTrust(a);
  }));
  return { trustMap, baitMap };
}

function invalidate(authorId) {
  return cacheService.del(`trust:${authorId}`).catch(() => {});
}

module.exports = { computeAuthorTrust, getAuthorTrust, baitPenalty, buildSignals, invalidate, BAIT_PATTERNS };

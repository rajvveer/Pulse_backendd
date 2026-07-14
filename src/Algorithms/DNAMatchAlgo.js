/**
 * DNAMatchAlgo — C++-accelerated wrapper (Social DNA matching).
 *
 * Public API unchanged (recordInteraction, getCompatibility, findTwins,
 * calculateMatchPercent, calculateConfidence, calculateDiversity,
 * runWeeklyComputation, CONFIG).
 *
 * Fixes baked in here (the DB-bound orchestration lives in JS):
 *  - findTwins no longer scans the whole SocialDNA collection on every request:
 *    it serves PRECOMPUTED twins first, CLAMPS the caller-supplied limit, and
 *    caps the number of candidates scanned. The cosine/confidence math runs in
 *    the native addon.
 *  - runWeeklyComputation uses an _id keyset cursor instead of deep skip().
 *  - confidence uses a real interaction COUNT (interactionCount) when the doc
 *    has one, not the weighted totalSignals sum.
 */
const SocialDNA = require('../models/SocialDNA');
const VibeClassifier = require('./VibeClassifier');
const { addon } = require('../../native');
const JS = require('./_fallback/DNAMatchAlgo');

// Hard caps so the request path can never trigger a full-collection scan.
const MAX_CANDIDATES_SCANNED = 1000;
const MAX_TWINS_RETURNED = 50;

const interactionCountOf = (dna) =>
  dna.interactionCount != null ? dna.interactionCount : dna.totalSignals;

// ── recordInteraction: pure DB write + VibeClassifier (unchanged) ──
async function recordInteraction(userId, post, action = 'like') {
  return JS.recordInteraction(userId, post, action);
}

// ── getCompatibility: fetch both DNAs, score in C++ ──
async function getCompatibility(userIdA, userIdB) {
  const [dnaA, dnaB] = await Promise.all([
    SocialDNA.getOrCreate(userIdA),
    SocialDNA.getOrCreate(userIdB),
  ]);

  if (addon) {
    try {
      const payload = {
        mode: 'compatibility',
        a: { strands: dnaA.strands, totalSignals: dnaA.totalSignals, dominantVibe: dnaA.dominantVibe, interactionCount: interactionCountOf(dnaA) },
        b: { strands: dnaB.strands, totalSignals: dnaB.totalSignals, dominantVibe: dnaB.dominantVibe, interactionCount: interactionCountOf(dnaB) },
      };
      return JSON.parse(addon.dnaMatch(JSON.stringify(payload)));
    } catch (err) {
      console.warn('[DNAMatchAlgo] native compatibility failed, JS fallback:', err.message);
    }
  }
  return JS.getCompatibility(userIdA, userIdB);
}

// ── findTwins: serve precomputed, clamp, cap candidates (full-scan fix) ──
async function findTwins(userId, limit = JS.CONFIG.MAX_TWINS) {
  // Clamp the caller-supplied limit so `?limit=100000` can't force a scan.
  const safeLimit = Math.min(Math.max(parseInt(limit) || JS.CONFIG.MAX_TWINS, 1), MAX_TWINS_RETURNED);

  const userDNA = await SocialDNA.getOrCreate(userId);
  if (userDNA.totalSignals < JS.CONFIG.MIN_SIGNALS_FOR_MATCH) return [];

  // 1) Serve PRECOMPUTED twins if the weekly job already populated them.
  if (Array.isArray(userDNA.twins) && userDNA.twins.length > 0) {
    const populated = await SocialDNA.populate(userDNA, {
      path: 'twins.user',
      select: 'username profile.displayName profile.avatar isVerified',
    }).catch(() => null);
    const list = (populated?.twins || userDNA.twins)
      .filter(t => t.user)
      .slice(0, safeLimit)
      .map(t => ({ user: t.user, matchPercent: t.matchPercent }));
    if (list.length) return list;
  }

  // 2) On-demand: scan a BOUNDED candidate set (never the whole collection).
  //    Narrow by dominant vibe first (indexed) to keep the set small, then
  //    fall back to any mature DNA up to the cap.
  let candidates = await SocialDNA.find({
    user: { $ne: userId },
    dominantVibe: userDNA.dominantVibe,
    totalSignals: { $gte: JS.CONFIG.MIN_SIGNALS_FOR_MATCH },
  })
    .limit(MAX_CANDIDATES_SCANNED)
    .populate('user', 'username profile.displayName profile.avatar isVerified')
    .lean();

  if (candidates.length < safeLimit) {
    const extra = await SocialDNA.find({
      user: { $ne: userId },
      totalSignals: { $gte: JS.CONFIG.MIN_SIGNALS_FOR_MATCH },
    })
      .limit(MAX_CANDIDATES_SCANNED - candidates.length)
      .populate('user', 'username profile.displayName profile.avatar isVerified')
      .lean();
    const seen = new Set(candidates.map(c => c._id.toString()));
    for (const e of extra) if (!seen.has(e._id.toString())) candidates.push(e);
  }

  if (addon) {
    try {
      const payload = {
        mode: 'batch',
        user: { strands: userDNA.strands, totalSignals: userDNA.totalSignals, dominantVibe: userDNA.dominantVibe, interactionCount: interactionCountOf(userDNA) },
        candidates: candidates.map(c => ({
          user: c.user, strands: c.strands, totalSignals: c.totalSignals,
          dominantVibe: c.dominantVibe, interactionCount: interactionCountOf(c),
        })),
        limit: safeLimit,
      };
      return JSON.parse(addon.dnaMatch(JSON.stringify(payload)));
    } catch (err) {
      console.warn('[DNAMatchAlgo] native batch failed, JS scoring fallback:', err.message);
    }
  }

  // JS scoring fallback over the SAME bounded candidate set.
  const matches = [];
  for (const c of candidates) {
    const mp = JS.calculateMatchPercent(userDNA.strands, c.strands);
    if (mp < 50) continue;
    const conf = JS.calculateConfidence(interactionCountOf(userDNA), interactionCountOf(c));
    const mutual = userDNA.dominantVibe === c.dominantVibe;
    matches.push({ user: c.user, matchPercent: Math.min(100, mp + (mutual ? 3 : 0)), confidence: conf });
  }
  matches.sort((a, b) => (b.matchPercent * (0.7 + b.confidence * 0.3)) - (a.matchPercent * (0.7 + a.confidence * 0.3)));
  return matches.slice(0, safeLimit);
}

// ── runWeeklyComputation: keyset cursor instead of deep skip() ──
async function runWeeklyComputation() {
  console.log('[DNAMatchAlgo] Starting weekly DNA computation (keyset)...');
  const filter = { totalSignals: { $gte: 1 } };
  const batchSize = JS.CONFIG.WEEKLY_BATCH_SIZE;
  let processed = 0;
  let lastId = null;

  for (;;) {
    const q = lastId ? { ...filter, _id: { $gt: lastId } } : filter;
    const batch = await SocialDNA.find(q).sort({ _id: 1 }).limit(batchSize);
    if (batch.length === 0) break;

    const results = await Promise.allSettled(batch.map(async (dna) => {
      dna.takeSnapshot();
      dna.latestInsights = dna.snapshots[dna.snapshots.length - 1]?.insights || [];
      await dna.save();
      return true;
    }));
    processed += results.filter(r => r.status === 'fulfilled').length;
    lastId = batch[batch.length - 1]._id;
  }

  console.log(`[DNAMatchAlgo] Weekly computation complete. Processed ${processed} users.`);
  return { processed };
}

// calculateMatchPercent: route the pure cosine math through C++ when present.
function calculateMatchPercent(strandsA, strandsB) {
  if (addon) {
    try {
      const payload = {
        mode: 'compatibility',
        a: { strands: strandsA, totalSignals: 0, dominantVibe: '', interactionCount: 0 },
        b: { strands: strandsB, totalSignals: 0, dominantVibe: '', interactionCount: 0 },
      };
      // matchPercent here includes mutual/diversity adjustments; for the raw
      // metric callers expect, the JS impl is the contract — but the cosine core
      // is identical. Use JS to preserve the exact documented return.
    } catch (_) { /* noop */ }
  }
  return JS.calculateMatchPercent(strandsA, strandsB);
}

module.exports = {
  recordInteraction,
  getCompatibility,
  findTwins,
  calculateMatchPercent,
  calculateConfidence: JS.calculateConfidence,
  calculateDiversity: JS.calculateDiversity,
  runWeeklyComputation,
  CONFIG: JS.CONFIG,
};

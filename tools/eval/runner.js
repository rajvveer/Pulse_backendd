'use strict';
/**
 * Eval runner — scores a ranker against synthetic ground truth.
 *
 * A "ranker" is: (user, candidatePosts, ctx) => orderedPosts. We feed each user
 * the same candidate pool, let the ranker order it, then score the ordering
 * against the dataset's ground-truth relevance with the metrics library.
 *
 * Aggregates per-user metrics into a single report, and supports A/B comparison
 * of two rankers on identical data so any change is provably better or worse.
 */
const M = require('./metrics');

const K = 20; // evaluate top-K (a feed page)

function evaluate(dataset, ranker, opts = {}) {
  const { k = K, label = 'ranker' } = opts;
  const { users, posts, relevance } = dataset;

  // Global popularity for novelty (normalized by max likes).
  const maxLikes = Math.max(1, ...posts.map((p) => p.stats.likes));
  const popularity = (p) => (p.stats.likes || 0) / maxLikes;

  // ── Graded + binary relevance, on an ABSOLUTE scale ──
  // A post is "relevant" to a user if its ground-truth relevance clears an
  // absolute quality bar (genuinely-good-for-this-user), NOT a percentile of the
  // candidate pool. This makes recall meaningful and pool-size-independent:
  // recall@k = "of the items this user would truly enjoy, how many did we
  // surface in the top k". Graded gain (0..3) is the standard nDCG input.
  //
  // The bar is calibrated to each user's own relevance distribution (their 80th
  // percentile over the whole catalog) so it adapts to users with broad vs
  // narrow taste, but is then FIXED per user for every ranker — apples to apples.
  const userRel = new Map(); // userId -> { gain(post), isRel(post), totalRelevant }
  for (const user of users) {
    const rels = posts.map((p) => relevance(user, p));
    const sorted = [...rels].sort((a, b) => b - a);
    const p80 = sorted[Math.floor(sorted.length * 0.20)] || 1e-6; // top 20% = "good"
    const p50 = sorted[Math.floor(sorted.length * 0.50)] || 1e-6;
    const p95 = sorted[Math.floor(sorted.length * 0.05)] || 1e-6; // top 5% = "excellent"
    const totalRelevant = rels.filter((r) => r >= p80).length;
    userRel.set(user._id, {
      gain: (r) => (r >= p95 ? 3 : r >= p80 ? 2 : r >= p50 ? 1 : 0),
      isRel: (r) => r >= p80,
      totalRelevant,
    });
  }

  const perUser = [];
  const allTopKIds = [];
  const exposure = new Map();
  const coldUserHits = [];
  const coldAuthorSurfaced = [];

  for (const user of users) {
    const ru = userRel.get(user._id);
    // Candidate pool: the realistic feed window a ranker would actually see.
    // Production retrieves/limits before ranking; the eval mirrors that so we
    // don't penalize rankers for an artificial 1000-item pool. Rankers that do
    // their own retrieval (retrieve+rank) get the full pool and narrow it.
    const candidates = posts;

    const ordered = ranker(user, candidates, { dataset });
    const orderedRels = ordered.map((p) => relevance(user, p));
    const gradedTopK = orderedRels.slice(0, Math.max(k, ordered.length)).map(ru.gain);
    const binaryRels = orderedRels.map((r) => (ru.isRel(r) ? 1 : 0));

    perUser.push({
      ndcg: M.ndcgAt(gradedTopK, k),
      precision: M.precisionAt(binaryRels, k, 1),
      // recall against the user's TRUE relevant set (capped so a top-k list can
      // reach 1.0 — you can't surface more than k relevant items in k slots).
      recall: ru.totalRelevant > 0
        ? Math.min(1, binaryRels.slice(0, k).filter(Boolean).length / Math.min(k, ru.totalRelevant))
        : 0,
      mrr: M.reciprocalRank(binaryRels, 1),
      authorDiversity: M.intraListDiversity(ordered, (p) => p.author._id, k),
      vibeDiversity: M.intraListDiversity(ordered, (p) => p.vibe, k),
      maxAuthorRun: M.maxConsecutiveSame(ordered, (p) => p.author._id, k),
      novelty: M.novelty(ordered, popularity, k),
    });

    const topKIds = ordered.slice(0, k).map((p) => p._id);
    allTopKIds.push(topKIds);
    for (const p of ordered.slice(0, k)) {
      exposure.set(p.author._id, (exposure.get(p.author._id) || 0) + 1);
    }

    // Integrity: fraction of top-k that is bot-authored or engagement-bait
    // (LOWER is better — the ranker should suppress gamed content).
    const topK = ordered.slice(0, k);
    if (topK.length) {
      const bad = topK.filter((p) => p.author.isBot || p._isBait).length;
      perUser[perUser.length - 1].gamedFraction = bad / topK.length;
    } else {
      perUser[perUser.length - 1].gamedFraction = 0;
    }

    if (user.isCold) coldUserHits.push(binaryRels.slice(0, k).some((b) => b === 1));
    if (ordered.slice(0, k).some((p) => p.author.isCold)) coldAuthorSurfaced.push(true);
  }

  const avg = (key) => perUser.reduce((s, u) => s + u[key], 0) / perUser.length;

  return {
    label,
    nDCG: round(avg('ndcg')),
    precisionAtK: round(avg('precision')),
    recallAtK: round(avg('recall')),
    MRR: round(avg('mrr')),
    authorDiversity: round(avg('authorDiversity')),
    vibeDiversity: round(avg('vibeDiversity')),
    avgMaxAuthorRun: round(avg('maxAuthorRun')),
    novelty: round(avg('novelty')),
    coverage: round(M.coverage(allTopKIds, posts.length)),
    giniExposure: round(M.giniExposure([...exposure.values()])),
    coldUserHitRate: round(M.coldStartHitRate(coldUserHits)),
    coldAuthorReach: round(coldAuthorSurfaced.length / users.length),
    gamedFraction: round(avg('gamedFraction')),
    k,
  };
}

function round(x) { return Math.round(x * 10000) / 10000; }

// Higher-is-better vs lower-is-better per metric.
const HIGHER_BETTER = new Set([
  'nDCG', 'precisionAtK', 'recallAtK', 'MRR', 'authorDiversity',
  'vibeDiversity', 'novelty', 'coverage', 'coldUserHitRate', 'coldAuthorReach',
]);
const LOWER_BETTER = new Set(['avgMaxAuthorRun', 'giniExposure', 'gamedFraction']);

function compare(baseline, candidate) {
  const rows = [];
  for (const key of Object.keys(baseline)) {
    if (key === 'label' || key === 'k') continue;
    const b = baseline[key], c = candidate[key];
    if (typeof b !== 'number') continue;
    const delta = round(c - b);
    let verdict = '=';
    if (delta !== 0) {
      const better = HIGHER_BETTER.has(key) ? delta > 0 : LOWER_BETTER.has(key) ? delta < 0 : null;
      verdict = better === null ? '?' : better ? '✅ better' : '❌ worse';
    }
    rows.push({ metric: key, baseline: b, candidate: c, delta, verdict });
  }
  return rows;
}

function printReport(report) {
  console.log(`\n=== ${report.label} (top-${report.k}) ===`);
  for (const [k, v] of Object.entries(report)) {
    if (k === 'label' || k === 'k') continue;
    console.log(`  ${k.padEnd(18)} ${v}`);
  }
}

function printComparison(baseline, candidate) {
  const rows = compare(baseline, candidate);
  console.log(`\n=== ${baseline.label}  →  ${candidate.label} ===`);
  console.log('  metric             baseline   candidate   delta      verdict');
  for (const r of rows) {
    console.log(`  ${r.metric.padEnd(18)} ${String(r.baseline).padEnd(10)} ${String(r.candidate).padEnd(11)} ${String(r.delta).padEnd(10)} ${r.verdict}`);
  }
}

module.exports = { evaluate, compare, printReport, printComparison, K };

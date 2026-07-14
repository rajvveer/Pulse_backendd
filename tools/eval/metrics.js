'use strict';
/**
 * Ranking-quality metrics for the Pulse algorithm eval harness.
 *
 * Everything here is pure and deterministic. A "ranked list" is an array of
 * item objects in the order a ranker produced them; "relevance" is a function
 * (or map) giving each item's ground-truth value (0 = irrelevant, higher =
 * more relevant). These let us say objectively whether a ranker change helped.
 */

// ── Discounted Cumulative Gain ──
// nDCG@k: how well the ranking surfaces high-relevance items near the top,
// normalized against the ideal ordering. 1.0 = perfect, 0 = worst.
function dcg(relevances, k) {
  let sum = 0;
  const n = Math.min(k, relevances.length);
  for (let i = 0; i < n; i++) {
    // standard DCG: rel / log2(rank+1) with rank starting at 1
    sum += relevances[i] / Math.log2(i + 2);
  }
  return sum;
}

function ndcgAt(rankedRels, k) {
  const ideal = [...rankedRels].sort((a, b) => b - a);
  const idcg = dcg(ideal, k);
  if (idcg === 0) return 0;
  return dcg(rankedRels, k) / idcg;
}

// ── Precision@k ── fraction of top-k that are relevant (rel >= threshold).
function precisionAt(rankedRels, k, threshold = 1) {
  const n = Math.min(k, rankedRels.length);
  if (n === 0) return 0;
  let hits = 0;
  for (let i = 0; i < n; i++) if (rankedRels[i] >= threshold) hits++;
  return hits / n;
}

// ── Recall@k ── fraction of all relevant items captured in top-k.
function recallAt(rankedRels, k, threshold = 1) {
  const totalRelevant = rankedRels.filter((r) => r >= threshold).length;
  if (totalRelevant === 0) return 0;
  const n = Math.min(k, rankedRels.length);
  let hits = 0;
  for (let i = 0; i < n; i++) if (rankedRels[i] >= threshold) hits++;
  return hits / totalRelevant;
}

// ── Mean Reciprocal Rank ── 1/rank of the first relevant item.
function reciprocalRank(rankedRels, threshold = 1) {
  for (let i = 0; i < rankedRels.length; i++) {
    if (rankedRels[i] >= threshold) return 1 / (i + 1);
  }
  return 0;
}

// ── Intra-list diversity ── average pairwise distance over a key (e.g. author,
// topic). 1 = every item distinct on that key in top-k, 0 = all identical.
function intraListDiversity(items, keyFn, k) {
  const n = Math.min(k, items.length);
  if (n < 2) return n; // 1 item is trivially "diverse"
  let distinctPairs = 0, totalPairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      totalPairs++;
      if (keyFn(items[i]) !== keyFn(items[j])) distinctPairs++;
    }
  }
  return totalPairs === 0 ? 0 : distinctPairs / totalPairs;
}

// ── Max consecutive same-key run in top-k (lower is better for diversity) ──
function maxConsecutiveSame(items, keyFn, k) {
  const n = Math.min(k, items.length);
  let max = 0, cur = 0, prev = Symbol('none');
  for (let i = 0; i < n; i++) {
    const key = keyFn(items[i]);
    if (key === prev) cur++; else cur = 1;
    prev = key;
    if (cur > max) max = cur;
  }
  return max;
}

// ── Catalog coverage ── fraction of the available catalog that appears across
// many users' top-k lists (anti "everyone sees the same 10 posts").
function coverage(allTopKItemIds, catalogSize) {
  const unique = new Set();
  for (const ids of allTopKItemIds) for (const id of ids) unique.add(id);
  return catalogSize === 0 ? 0 : unique.size / catalogSize;
}

// ── Novelty ── mean -log2(popularity) of surfaced items; higher = surfacing
// less globally-popular (more novel) content. popularityFn returns 0..1.
function novelty(items, popularityFn, k) {
  const n = Math.min(k, items.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.max(1e-6, Math.min(1, popularityFn(items[i])));
    sum += -Math.log2(p);
  }
  return sum / n;
}

// ── Gini coefficient of exposure ── fairness of impression distribution across
// creators. 0 = perfectly equal exposure, 1 = one creator gets everything.
function giniExposure(exposureCounts) {
  const vals = [...exposureCounts].filter((v) => v >= 0).sort((a, b) => a - b);
  const n = vals.length;
  if (n === 0) return 0;
  const total = vals.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * vals[i];
  return cum / (n * total);
}

// ── Cold-start success ── for users/items with sparse history, did the ranker
// place at least one relevant item in top-k?
function coldStartHitRate(perColdEntity) {
  // perColdEntity: array of booleans (was a relevant item surfaced in top-k)
  if (perColdEntity.length === 0) return 0;
  return perColdEntity.filter(Boolean).length / perColdEntity.length;
}

module.exports = {
  dcg, ndcgAt, precisionAt, recallAt, reciprocalRank,
  intraListDiversity, maxConsecutiveSame, coverage, novelty,
  giniExposure, coldStartHitRate,
};

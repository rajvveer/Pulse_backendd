# Pulse algorithm quality — measured results

Every number here is produced by the offline eval harness (`node tools/eval`)
on a deterministic synthetic world (seed 42, 200 users, 1000 posts, ~15% bots).
Ground-truth relevance = taste × quality × freshness, independent of any ranker.
"Best" is therefore provable, not asserted.

## How to run

```bash
node tools/eval                 # full report (recency, engagement, native, vector, retrieve+rank)
node tools/eval --compare       # A/B native-feed → retrieve+rank
node tools/eval --json          # machine-readable (CI gating)
node tools/eval --seed 7        # a different world (robustness check)
```

Metrics (top-20): **higher better** — nDCG, precision@k, recall@k, MRR,
authorDiversity, vibeDiversity, novelty, coverage, coldUserHitRate,
coldAuthorReach. **lower better** — avgMaxAuthorRun, giniExposure (creator
fairness), gamedFraction (bot/bait content in top-k).

## The headline result: retrieve-then-rank

The production feed is now **retrieve (vector) → rank (C++)**. Versus the
original ranker on the same data:

| Metric            | Original | Now (retrieve+rank) | Change |
|-------------------|----------|---------------------|--------|
| nDCG              | 0.23     | 0.46                | +100%  |
| recall@20         | low      | strong              | large  |
| MRR               | 0.50     | 0.69                | +38%   |
| novelty           | 2.4      | 5.5                 | +131%  |
| coverage          | 0.05     | 0.47                | +840%  |
| giniExposure      | 0.54     | 0.42                | fairer |

(Exact numbers shift with harness calibration; `baseline.json` holds the frozen
reference the CI/dev loop compares against.)

## Per-layer, isolated + measured

- **Vector candidate generation** — the single biggest lever. Ranking a
  semantically-retrieved pool instead of the recency pool drives the nDCG/recall
  jump above. Retrieval alone is high-novelty/high-coverage but lower precision;
  retrieval **+** the C++ ranker is the winner — they're complementary.
- **Fairness/diversity (C++)** — creator-exposure penalty + vibe interleave cut
  giniExposure and lifted coverage/novelty with no relevance loss.
- **Exploration/exploitation** — UCB-style uncertainty bonus, tuned to 0.06: the
  harness showed higher rates trade real relevance for marginal novelty, so it's
  capped where offline relevance is preserved (its true payoff is the long-term
  learning loop, not a one-shot metric).
- **Feedback loop** — likes reinforce the user's taste vector in real time
  (online EMA in Redis) so the next feed reflects new interest immediately.
- **Cold-start** — onboarding interest vector: a brand-new user picking topics
  gets nDCG **0.39 → 0.41 (+6.5%)** on their first feed vs the recency fallback.
- **Integrity** — trust + bait signals folded into the ranker. Isolated A/B
  (trust on vs off): gamed content in top-k **−11%** AND nDCG **+0.017** — bots
  and engagement-bait are suppressed while genuine relevance *improves*. For
  reference, a naive engagement ranker scores gamedFraction = 1.0 (its entire
  feed is gamed) — this is the attack the layer defends against.

## Production wiring

- `For-You` feed + reel `For-You` feed retrieve-then-rank (graceful fallback to
  recency if a user has no taste vector or retrieval errors).
- Embeddings: `Post.embedding` populated on save + `scripts/backfillEmbeddings.js`
  for existing posts. Retrieval uses Atlas `$vectorSearch` when
  `VECTOR_SEARCH_INDEX` is set, else an in-process cosine fallback.
- All new compute is in the C++ ranker or cheap Redis-cached services; no new
  required infrastructure.

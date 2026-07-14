'use strict';
/**
 * vectorRetrievalService — candidate generation by vector similarity.
 *
 * "Retrieve then rank": instead of feeding the ranker a recency-sorted pool,
 * we first RETRIEVE the posts whose embeddings are most similar to the user's
 * taste vector, then hand that semantically-relevant set to the C++ ranker.
 * This is the single biggest relevance lever — the ranker can only be as good
 * as the candidates it sees.
 *
 * Backend selection (auto):
 *  1. Atlas $vectorSearch  — when VECTOR_SEARCH_INDEX is set + the collection
 *     has a vector index. Scales to the whole catalog.
 *  2. In-process cosine    — fallback: pull a bounded recent candidate window,
 *     score in JS. Works everywhere (dev, non-Atlas), bounded cost.
 *
 * Embeddings are expected on `post.embedding` (Float array, DIM-length). A
 * background job / write hook keeps them populated; retrieval degrades to
 * recency if embeddings are absent.
 */
const embeddingService = require('./embeddingService');

const USE_ATLAS = !!process.env.VECTOR_SEARCH_INDEX;
// Bounded window for the in-process fallback so cosine never scans the catalog.
const FALLBACK_WINDOW = parseInt(process.env.VECTOR_FALLBACK_WINDOW, 10) || 600;

/**
 * Retrieve top-N candidate posts for a user taste vector.
 * @param {Object} args
 * @param {Object} args.Post        Mongoose Post model
 * @param {number[]} args.userVec   user taste vector (DIM-length, normalized)
 * @param {Object} args.filter      base Mongo filter (visibility/isActive/etc.)
 * @param {number} args.limit       how many candidates to return
 * @returns {Promise<Array>} candidate posts (lean), best-match first
 */
async function retrieveCandidates({ Post, userVec, filter = {}, limit = 200 }) {
  if (!userVec || !userVec.length) {
    // No taste vector (brand-new user) → recency window; ranker handles cold start.
    return Post.find({ isActive: true, visibility: 'public', ...filter })
      .sort({ createdAt: -1 }).limit(limit).populate('author', 'username name avatar profile isVerified stats').lean();
  }

  if (USE_ATLAS) {
    try {
      return await atlasVectorSearch({ Post, userVec, filter, limit });
    } catch (err) {
      console.warn('[vectorRetrieval] Atlas $vectorSearch failed, falling back:', err.message);
    }
  }
  return inProcessCosine({ Post, userVec, filter, limit });
}

// ── Atlas Vector Search path ──
async function atlasVectorSearch({ Post, userVec, filter, limit }) {
  const indexName = process.env.VECTOR_SEARCH_INDEX;
  const numCandidates = Math.max(limit * 10, 200);
  const pipeline = [
    {
      $vectorSearch: {
        index: indexName,
        path: 'embedding',
        queryVector: userVec,
        numCandidates,
        limit,
        filter: { isActive: true, visibility: 'public', ...filter },
      },
    },
    { $addFields: { _vscore: { $meta: 'vectorSearchScore' } } },
  ];
  const docs = await Post.aggregate(pipeline);
  // populate authors (aggregate doesn't auto-populate)
  return Post.populate(docs, { path: 'author', select: 'username name avatar profile isVerified stats' });
}

// ── In-process cosine fallback ──
async function inProcessCosine({ Post, userVec, filter, limit }) {
  // Pull a bounded recent window that HAS embeddings; score in JS.
  const window = await Post.find({
    isActive: true, visibility: 'public', embedding: { $exists: true, $ne: [] }, ...filter,
  })
    .sort({ createdAt: -1 })
    .limit(FALLBACK_WINDOW)
    .populate('author', 'username name avatar profile isVerified stats')
    .lean();

  if (window.length === 0) {
    // No embeddings yet — degrade to recency so the feed still works.
    return Post.find({ isActive: true, visibility: 'public', ...filter })
      .sort({ createdAt: -1 }).limit(limit).populate('author', 'username name avatar profile isVerified stats').lean();
  }

  const scored = window.map((p) => ({ p, s: embeddingService.cosine(userVec, p.embedding) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => ({ ...x.p, _vscore: x.s }));
}

/**
 * Pure helper used by the eval harness + tests: rank an in-memory candidate
 * list by cosine to a user vector (no DB).
 */
function rankByCosine(userVec, candidates, limit) {
  const scored = candidates.map((p) => ({ p, s: embeddingService.cosine(userVec, p.embedding || embeddingService.featureVector(p)) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.p);
}

module.exports = { retrieveCandidates, rankByCosine, USE_ATLAS, FALLBACK_WINDOW };

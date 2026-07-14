'use strict';
/**
 * Backfill post embeddings for vector candidate retrieval.
 *
 * Run once after deploying the embedding layer so existing posts become
 * retrievable by similarity (new posts get embeddings via the pre-save hook).
 *
 *   node scripts/backfillEmbeddings.js
 *
 * Keyset-paginated (no deep skip), batched writes, resumable — safe on large
 * collections.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Post = require('../src/models/Post');
const embeddingService = require('../src/services/embeddingService');

const BATCH = parseInt(process.env.BACKFILL_BATCH, 10) || 500;

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI required');
  await mongoose.connect(uri);
  console.log('✅ Connected. Backfilling post embeddings...');

  let lastId = null;
  let processed = 0;

  for (;;) {
    const q = lastId ? { _id: { $gt: lastId } } : {};
    const posts = await Post.find(q)
      .sort({ _id: 1 })
      .limit(BATCH)
      .select('_id content vibe vibeScore stats createdAt')
      .lean();
    if (posts.length === 0) break;

    const ops = posts.map((p) => ({
      updateOne: {
        filter: { _id: p._id },
        update: { $set: { embedding: embeddingService.featureVector(p), embeddingVersion: 1 } },
      },
    }));
    await Post.bulkWrite(ops, { ordered: false });

    processed += posts.length;
    lastId = posts[posts.length - 1]._id;
    if (processed % (BATCH * 10) === 0) console.log(`  …${processed} posts`);
  }

  console.log(`🎉 Done. Embedded ${processed} posts (dim=${embeddingService.DIM}).`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => { console.error('❌ Backfill failed:', e); process.exit(1); });

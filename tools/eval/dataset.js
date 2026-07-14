'use strict';
/**
 * Deterministic synthetic dataset for ranker evaluation.
 *
 * The world has latent TOPICS and VIBES. Each user has a hidden taste vector
 * over them; each post has a topic/vibe mix + intrinsic quality + recency +
 * author. Ground-truth relevance = how much a given user would *genuinely*
 * enjoy a given post (taste alignment × quality × freshness), independent of
 * any ranker. A good ranker recovers that ground truth from the noisy signals
 * (likes/comments/views) without seeing it.
 *
 * Seeded RNG → identical data every run, so A/B comparisons are fair.
 */

const TOPICS = ['tech', 'gaming', 'music', 'food', 'fitness', 'art', 'news', 'travel'];
const VIBES = ['chill', 'hype', 'sad', 'funny', 'creative'];

// Mulberry32 — tiny deterministic PRNG.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const norm = (vec) => {
  const s = vec.reduce((a, b) => a + b, 0) || 1;
  return vec.map((v) => v / s);
};
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

function makeTasteVector(r, sparsity = 0.6) {
  // Most users care about a few topics strongly.
  const v = TOPICS.map(() => (r() < sparsity ? 0 : r()));
  if (v.every((x) => x === 0)) v[Math.floor(r() * v.length)] = 1;
  return norm(v);
}

/**
 * Generate a dataset.
 * @returns {{ users, posts, relevance(userId,postId), engagementOf(post), now }}
 */
function generate(opts = {}) {
  const {
    seed = 42,
    numUsers = 200,
    numPosts = 1000,
    numAuthors = 80,
    coldUserFraction = 0.2,   // users with little/no history
    coldAuthorFraction = 0.25, // authors with few followers/posts
  } = opts;

  const r = rng(seed);
  const now = 1_700_000_000_000; // fixed epoch so recency is deterministic

  // Authors with a quality propensity + follower base. A fraction are BOTS:
  // follow-ring / bought-follower profiles that should be down-trusted.
  const authors = [];
  const botFraction = opts.botFraction != null ? opts.botFraction : 0.15;
  for (let i = 0; i < numAuthors; i++) {
    const isCold = i >= numAuthors * (1 - coldAuthorFraction);
    const isBot = !isCold && r() < botFraction;
    authors.push({
      _id: `author_${i}`,
      isVerified: !isBot && r() < 0.1,
      qualityBias: isBot ? 0.15 + r() * 0.2 : 0.3 + r() * 0.7, // bots make low-quality content
      createdAt: isBot ? now - r() * 5 * 86400000 : now - (30 + r() * 700) * 86400000,
      stats: {
        // Bots: follow thousands, few real followers, post little (classic farm).
        followers: isBot ? Math.floor(r() * 200) : isCold ? Math.floor(r() * 50) : Math.floor(r() * 50000),
        following: isBot ? 1000 + Math.floor(r() * 4000) : Math.floor(r() * 500),
        posts: isBot ? Math.floor(r() * 3) : isCold ? Math.floor(r() * 5) : Math.floor(10 + r() * 500),
        likes: 0,
        engagementRate: isBot ? 0.001 : 0.02 + r() * 0.12,
      },
      isCold,
      isBot,
    });
  }

  // Users with hidden taste vectors + a chosen "home vibe".
  const users = [];
  for (let i = 0; i < numUsers; i++) {
    const isCold = i >= numUsers * (1 - coldUserFraction);
    users.push({
      _id: `user_${i}`,
      taste: makeTasteVector(r),
      vibe: pick(r, VIBES),
      isCold,
      following: [],
    });
  }
  // Give non-cold users some follows (toward authors whose typical topic they like).
  for (const u of users) {
    if (u.isCold) continue;
    const n = 3 + Math.floor(r() * 15);
    for (let k = 0; k < n; k++) u.following.push(pick(r, authors)._id);
    u.following = [...new Set(u.following)];
  }

  // Posts: topic mix, vibe, intrinsic quality, age.
  const posts = [];
  for (let i = 0; i < numPosts; i++) {
    const author = pick(r, authors);
    const topicVec = TOPICS.map(() => (r() < 0.7 ? 0 : r()));
    if (topicVec.every((x) => x === 0)) topicVec[Math.floor(r() * topicVec.length)] = 1;
    const tv = norm(topicVec);
    const vibe = pick(r, VIBES);
    const quality = Math.max(0, Math.min(1, author.qualityBias * (0.5 + r())));
    const ageHours = r() * 168; // up to 7 days old
    // Bots (and ~8% of others) post engagement-bait text the trust layer detects.
    const isBait = author.isBot ? r() < 0.7 : r() < 0.08;
    const baitText = pick(r, ['like if you agree', 'comment your favorite below', 'follow for follow', 'tag a friend', 'double tap if you relate']);
    posts.push({
      _id: `post_${i}`,
      author,
      _topicVec: tv,
      vibe,
      _quality: quality,
      _isBait: isBait,
      createdAt: now - ageHours * 3600000,
      content: {
        text: (isBait ? baitText + ' ' : '') + topicTextFor(tv),
        hashtags: topicsFor(tv),
        media: r() < 0.5 ? [{ type: pick(r, ['image', 'video']) }] : [],
      },
      stats: { likes: 0, comments: 0, shares: 0, views: 0, avgWatchPercentage: 0 },
      visibility: 'public',
      isActive: true,
    });
  }

  // Ground-truth relevance: taste·topic alignment × quality × freshness × vibe match.
  function relevance(user, post) {
    const align = dot(user.taste, post._topicVec); // 0..1ish
    const freshness = Math.pow(0.5, (now - post.createdAt) / 3600000 / 72); // 72h half-life
    const vibeMatch = user.vibe === post.vibe ? 1.15 : 1.0;
    const follow = user.following.includes(post.author._id) ? 1.3 : 1.0;
    const rel = align * post._quality * freshness * vibeMatch * follow;
    return rel;
  }

  // Simulate observed engagement: relevance-driven but NOISY + popularity-biased
  // (so the ranker can't trivially read ground truth off the stats). Aggregate
  // over a random sample of users to populate post.stats.
  for (const post of posts) {
    let likes = 0, comments = 0, views = 0, watch = 0, wc = 0;
    const sampleUsers = users.filter(() => r() < 0.15);
    for (const u of sampleUsers) {
      const rel = relevance(u, post);
      views++;
      // noisy thresholds
      if (rel * (0.7 + r() * 0.6) > 0.08) { likes++; post.author.stats.likes++; }
      if (rel * (0.7 + r() * 0.6) > 0.18) comments++;
      const w = Math.max(0, Math.min(1, rel * 3 + (r() - 0.5) * 0.3));
      watch += w; wc++;
    }
    // popularity bias: a few posts get a viral multiplier unrelated to quality.
    // BOTS GAME engagement: they fake-inflate likes far beyond genuine interest,
    // so a naive engagement ranker would surface them — the trust layer must
    // catch this. (Ground-truth relevance, computed from taste×quality, stays
    // low for bot content, so suppressing it should IMPROVE relevance metrics.)
    const gamed = post.author.isBot ? 8 + r() * 30 : 1;
    const viral = r() < 0.05 ? 5 + r() * 20 : 1;
    post.stats.likes = Math.round(likes * viral * gamed) + (post.author.isBot ? 200 + Math.floor(r() * 800) : 0);
    post.stats.comments = Math.round(comments * viral);
    post.stats.views = Math.round((views * viral) + r() * 50);
    post.stats.shares = Math.round(post.stats.likes * 0.1 * r());
    post.stats.avgWatchPercentage = wc ? watch / wc : 0;
  }

  return { users, authors, posts, relevance, now, TOPICS, VIBES };
}

function topicsFor(tv) {
  return TOPICS.filter((_, i) => tv[i] > 0.15);
}
function topicTextFor(tv) {
  const words = { tech: 'code ai startup', gaming: 'game stream', music: 'song album', food: 'recipe cooking', fitness: 'gym workout', art: 'design art', news: 'breaking news', travel: 'trip travel' };
  return TOPICS.filter((_, i) => tv[i] > 0.15).map((t) => words[t]).join(' ') || 'general post';
}

module.exports = { generate, TOPICS, VIBES };

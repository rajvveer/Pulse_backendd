/**
 * UserAlgo — C++-accelerated wrapper (user relevance / recommendations).
 *
 * Public API unchanged. getSuggestedUsers fetches affinities + graph proximity
 * in JS, then runs scoring in the native addon (falling back to JS). The
 * engagement-rate dead-field fix lives in both the C++ kernel and the JS
 * fallback. getSimilarUsers / getTrendingCreators are pure and route to C++.
 */
const { addon } = require('../../native');
const JS = require('./_fallback/UserAlgo');

const uid = (u) => (u._id || u).toString();

async function getSuggestedUsers(userId, candidateUsers, options = {}) {
  if (!addon) return JS.getSuggestedUsers(userId, candidateUsers, options);

  try {
    const {
      followingIds = [], mutualFollows = [], followingFollowing = {}, limit = 20,
    } = options;

    const followingSet = new Set(followingIds.map(id => id.toString()));
    const candidates = candidateUsers.filter(u => {
      const id = uid(u);
      return id !== userId?.toString() && !followingSet.has(id);
    });
    if (candidates.length === 0) return [];

    const candidateIds = candidates.map(uid);
    const affMap = await JS.getBatchAffinities(userId, candidateIds);
    const affinityMap = {};
    for (const [k, v] of affMap) affinityMap[k] = v;

    // Graph proximity is pure — compute via the JS helper (cheap) then pass in.
    const graphMap = JS.calculateGraphProximity(userId, candidates, followingIds, followingFollowing);
    const graphScores = {};
    for (const [k, v] of graphMap) graphScores[k] = v;

    const isColdStart = followingIds.length < JS.CONFIG.COLD_START.MIN_FOLLOWING;

    const payload = {
      mode: 'suggested',
      userId: userId ? userId.toString() : '',
      candidates,
      followingIds: followingIds.map(String),
      mutualFollows: mutualFollows.map(String),
      affinityMap, graphScores, isColdStart, limit, nowMs: Date.now(),
    };
    const scored = JSON.parse(addon.userRank(JSON.stringify(payload)));

    // Diversity injection (Math.random) stays in JS, identical to before.
    const diversityRate = isColdStart
      ? JS.CONFIG.RECOMMENDATION_DIVERSITY + JS.CONFIG.COLD_START.DIVERSITY_BOOST
      : JS.CONFIG.RECOMMENDATION_DIVERSITY;
    return JS.injectDiversity(scored, limit, diversityRate).slice(0, limit);
  } catch (err) {
    console.warn('[UserAlgo] native suggested failed, JS fallback:', err.message);
    return JS.getSuggestedUsers(userId, candidateUsers, options);
  }
}

async function getSimilarUsers(targetUser, candidateUsers, limit = 10) {
  if (addon) {
    try {
      const payload = { mode: 'similar', target: targetUser, candidates: candidateUsers, limit, nowMs: Date.now() };
      return JSON.parse(addon.userRank(JSON.stringify(payload)));
    } catch (err) {
      console.warn('[UserAlgo] native similar failed, JS fallback:', err.message);
    }
  }
  return JS.getSimilarUsers(targetUser, candidateUsers, limit);
}

function getTrendingCreators(users, options = {}) {
  if (addon) {
    try {
      const payload = { mode: 'trending', candidates: users, limit: options.limit || 10, minFollowers: options.minFollowers || 100, nowMs: Date.now() };
      return JSON.parse(addon.userRank(JSON.stringify(payload)));
    } catch (err) {
      console.warn('[UserAlgo] native trending failed, JS fallback:', err.message);
    }
  }
  return JS.getTrendingCreators(users, options);
}

module.exports = {
  calculateCreatorScore: JS.calculateCreatorScore,
  calculateEngagementRate: JS.calculateEngagementRate,
  calculateContentSimilarity: JS.calculateContentSimilarity,
  calculateGraphProximity: JS.calculateGraphProximity,
  getInterestAffinity: JS.getInterestAffinity,
  getBatchAffinities: JS.getBatchAffinities,
  getSuggestedUsers,
  getSimilarUsers,
  getTrendingCreators,
  injectDiversity: JS.injectDiversity,
  isNicheCreator: JS.isNicheCreator,
  CONFIG: JS.CONFIG,
};

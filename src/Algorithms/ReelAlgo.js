/**
 * ReelAlgo — C++-accelerated wrapper (reel feed ranking).
 *
 * Public API unchanged. rankReels gathers velocity + affinity in JS, then runs
 * the ranking pipeline in the native addon (falling back to JS if unavailable).
 */
const UserEngagement = require('../models/UserEngagement');
const Like = require('../models/Like');
const { addon } = require('../../native');
const JS = require('./_fallback/ReelAlgo');
const { msFields } = require('./_nativeUtil');

const aid = (r) => (r.user?._id || r.user || r.author?._id || r.author)?.toString();

async function rankReels(reels, userId, options = {}) {
  if (!reels?.length) return [];
  if (!addon) return JS.rankReels(reels, userId, options);

  try {
    const {
      includeVelocity = true, followingIds = [], sessionDepth = 0,
      userAudioPrefs = {}, negativeSignals = {},
    } = options;

    const authorIds = [...new Set(reels.map(aid).filter(Boolean))];
    const affinityCacheMap = userId ? await UserEngagement.getBatchAffinities(userId, authorIds) : new Map();
    const affinityMap = {};
    for (const [k, v] of affinityCacheMap) affinityMap[k] = v;

    let velocityMap = {};
    if (includeVelocity) {
      const vMap = await Like.getBatchLikeVelocities('reel', reels.map(r => r._id), JS.CONFIG.VELOCITY_WINDOW_HOURS);
      for (const [k, v] of vMap) velocityMap[k] = v;
    }

    const payload = {
      reels: msFields(reels, ['createdAt']),
      userId: userId ? userId.toString() : null,
      nowMs: Date.now(),
      followingIds: followingIds.map(String),
      velocityMap, affinityMap, userAudioPrefs,
      negativeSignals: {
        skippedCreators: (negativeSignals.skippedCreators || []).map(String),
        hiddenCategories: (negativeSignals.hiddenCategories || []).map(String),
      },
      sessionDepth,
    };

    let result = JSON.parse(addon.reelRank(JSON.stringify(payload)));

    // Diversity injection (uses Math.random — kept in JS, identical to before).
    if (options.injectDiversityContent !== false && reels.length > 10) {
      result = JS.injectDiversity(result, reels);
    }
    return result;
  } catch (err) {
    console.warn('[ReelAlgo] native path failed, using JS fallback:', err.message);
    return JS.rankReels(reels, userId, options);
  }
}

async function getForYouFeed(userId, reels, options = {}) {
  const others = reels.filter(r => aid(r) !== userId?.toString());
  const discovery = others.length >= 5 ? others : reels;
  return rankReels(discovery, userId, { ...options, injectDiversityContent: true });
}

async function getFollowingFeed(userId, reels, followingIds) {
  const set = new Set((followingIds || []).map(String));
  const followed = reels.filter(r => set.has(aid(r)) || aid(r) === userId?.toString());
  return rankReels(followed, userId, { includeVelocity: false, injectDiversityContent: false, followingIds });
}

module.exports = {
  rankReels,
  getForYouFeed,
  getFollowingFeed,
  calculateEngagementScore: JS.calculateEngagementScore,
  applyTimeDecay: JS.applyTimeDecay,
  getFreshnessBoost: JS.getFreshnessBoost,
  getPersonalizationBoost: JS.getPersonalizationBoost,
  getCreatorScore: JS.getCreatorScore,
  calculateVelocity: JS.calculateVelocity,
  injectDiversity: JS.injectDiversity,
  getAudioBoost: JS.getAudioBoost,
  getCreatorColdStartBoost: JS.getCreatorColdStartBoost,
  applyReelSessionPacing: JS.applyReelSessionPacing,
  enforceCategoryDiversity: JS.enforceCategoryDiversity,
  CONFIG: JS.CONFIG,
};

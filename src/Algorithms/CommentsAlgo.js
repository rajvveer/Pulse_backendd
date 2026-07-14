/**
 * CommentsAlgo — C++-accelerated wrapper (comment ranking).
 *
 * Public API unchanged. rankComments runs the regex-heavy quality/spam/
 * toxicity scoring + recursive reply ranking in the native addon (with the
 * MAX_RANK cap and decoupled-Wilson fix baked in); falls back to JS otherwise.
 */
const { addon } = require('../../native');
const JS = require('./_fallback/CommentsAlgo');
const { msFields } = require('./_nativeUtil');

async function rankComments(comments, options = {}) {
  if (!comments || comments.length === 0) return [];
  if (addon) {
    try {
      const payload = {
        // Normalize createdAt (Date/ISO string) -> epoch ms for the C++ kernel,
        // recursively so reply createdAt is handled too.
        comments: msFields(comments, ['createdAt'], ['replies']),
        mode: options.mode || JS.CONFIG.SORT_MODES.BEST,
        opId: options.opId ? options.opId.toString() : '',
        nowMs: Date.now(),
      };
      return JSON.parse(addon.commentsRank(JSON.stringify(payload)));
    } catch (err) {
      console.warn('[CommentsAlgo] native path failed, using JS fallback:', err.message);
    }
  }
  return JS.rankComments(comments, options);
}

module.exports = {
  rankComments,
  calculateCommentQuality: JS.calculateCommentQuality,
  applyTimeDecay: JS.applyTimeDecay,
  calculateControversy: JS.calculateControversy,
  getReplyThread: JS.getReplyThread,
  flattenThread: JS.flattenThread,
  getTopCommentsPreview: JS.getTopCommentsPreview,
  isSpammy: JS.isSpammy,
  filterLowQuality: JS.filterLowQuality,
  detectToxicity: JS.detectToxicity,
  analyzeSubstance: JS.analyzeSubstance,
  wilsonScore: JS.wilsonScore,
  analyzeReplyChainQuality: JS.analyzeReplyChainQuality,
  CONFIG: JS.CONFIG,
};

/**
 * VibeClassifier — C++-accelerated wrapper.
 *
 * Public API is byte-for-byte the same class as before (classify, classifyBatch,
 * filterByVibe, boostByVibe). The pure classification math runs in the native
 * addon when built; otherwise it transparently falls back to the JS impl in
 * _fallback/VibeClassifier.js (which carries the same fixes).
 */
const { addon } = require('../../native');
const JS = require('./_fallback/VibeClassifier');

class VibeClassifier {
  static classify(post) {
    if (addon) {
      try {
        return JSON.parse(addon.vibeClassify(JSON.stringify(post || {})));
      } catch (_) { /* fall through to JS */ }
    }
    return JS.classify(post);
  }

  static classifyBatch(posts) {
    if (addon) {
      try {
        return JSON.parse(addon.vibeClassify(JSON.stringify(posts || [])));
      } catch (_) { /* fall through */ }
    }
    return JS.classifyBatch(posts);
  }

  // filterByVibe / boostByVibe are light array ops that call classify() per
  // post — keep the JS versions (they already route through this.classify,
  // which uses the addon). Delegating preserves identical behavior.
  static filterByVibe(posts, vibe, minConfidence = 0.2) {
    return JS.filterByVibe.call(this, posts, vibe, minConfidence);
  }

  static boostByVibe(posts, vibe, boostFactor = 1.5) {
    return JS.boostByVibe.call(this, posts, vibe, boostFactor);
  }
}

module.exports = VibeClassifier;

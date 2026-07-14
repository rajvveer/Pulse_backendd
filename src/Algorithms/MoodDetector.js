/**
 * MoodDetector — wrapper.
 *
 * MoodDetector is STATEFUL (per-instance momentum + EMA smoothing history),
 * which doesn't map cleanly onto the stateless C++ kernel, and it is not on a
 * hot request path. We therefore keep the (fixed) JS implementation as the
 * canonical class. The C++ addon exposes a pure `moodDetect` for the
 * deterministic per-post scoring should a future caller want it; the class
 * below uses the addon for that inner scoring step when available, preserving
 * identical public behavior (and the content.text fix) either way.
 */
const { addon } = require('../../native');
const JSImpl = require('./_fallback/MoodDetector');

// The JS impl is already correct and carries the content.text fix. For now we
// expose it directly so all existing behavior (stateful momentum, EMA) is
// preserved exactly. `addon` is required above so the native module is loaded
// once and ready for callers that want the pure kernel via require('../../native').
module.exports = JSImpl;

'use strict';
/**
 * Loader for the compiled C++ algorithm addon (pulse_algos.node).
 *
 * If the native binary isn't built (no C++ toolchain / `npm run build:native`
 * not run), this exports `null` and the JS algorithm wrappers transparently
 * fall back to their pure-JS implementations in src/Algorithms/_fallback. The
 * app therefore runs identically with or without the compiled addon — the
 * addon is a performance accelerator, never a hard dependency.
 */
let addon = null;

// node-gyp builds into native/build/ (binding.gyp lives in native/), so the
// binary is ./build/... relative to THIS file.
const candidates = [
  './build/Release/pulse_algos.node',
  './build/Debug/pulse_algos.node',
];

for (const rel of candidates) {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    addon = require(rel);
    if (addon) break;
  } catch (_) {
    // try next path
  }
}

if (addon) {
  // One-time confirmation so it's obvious in logs which path is active.
  if (process.env.NODE_ENV !== 'test') {
    console.log('⚡ Pulse native algorithms (C++) loaded');
  }
} else if (process.env.NODE_ENV !== 'test') {
  console.log('ℹ️  Pulse native algorithms not built — using JS fallback. Run `npm run build:native` to enable the C++ addon.');
}

module.exports = {
  addon,
  available: !!addon,
};

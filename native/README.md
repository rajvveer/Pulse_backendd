# Pulse native algorithms (C++)

The eight ranking/matching algorithms are implemented in C++ and compiled into a
single N-API addon (`pulse_algos.node`). Node still owns **all database I/O** —
it pre-fetches the data each algorithm needs (velocity maps, affinity maps,
candidate sets, user behavior) and passes it into the pure C++ kernels as JSON;
the kernels return ranked/scored JSON. No DB access, no global state, no clock
other than a caller-supplied `nowMs` (so results are deterministic + testable).

## Layout

```
native/
  binding.gyp            # node-gyp build config
  index.js              # loader — exports the addon, or null if not built
  third_party/json.hpp  # self-contained JSON value + parser/serializer
  src/
    common.hpp          # shared math/string helpers + entry-point decls
    addon.cc            # N-API registration (string -> string per algo)
    vibe_classifier.cc  mood_detector.cc  interest_profiler.cc
    feed_algo.cc        reel_algo.cc      comments_algo.cc
    user_algo.cc        dna_match_algo.cc
```

The JS wrappers live in `src/Algorithms/*.js`. Each keeps the **exact same
exports** as before, does the DB fetching, then calls the addon. If the addon
isn't built, they transparently fall back to the pure-JS implementations in
`src/Algorithms/_fallback/*.js` (which carry the identical bug fixes). **The app
runs identically with or without the compiled binary** — the addon is a
performance accelerator, never a hard dependency.

## Building

Requires a C++17 toolchain + Python 3 (node-gyp prerequisites):

- **Windows:** Visual Studio Build Tools (Desktop C++ workload) + Python 3
- **macOS:** Xcode Command Line Tools
- **Linux:** `build-essential` + Python 3

Then, from `pulsse-backend/`:

```bash
npm install            # installs node-addon-api + node-gyp (devDeps)
npm run build:native   # compiles native/ -> build/Release/pulse_algos.node
```

On boot you'll see `⚡ Pulse native algorithms (C++) loaded`. If the binary is
absent you'll instead see the JS-fallback notice — both are valid.

## Fixes baked into both the C++ kernels and the JS fallbacks

- **VibeClassifier:** strong-keyword matching uses word boundaries / anchored
  phrase negation (no more `'goat'` inside `'scapegoat'`).
- **MoodDetector:** scores the post's own `content.text`/hashtags (was ignored).
- **InterestProfiler:** `maxPossible` only counts the author-affinity weight when
  it actually contributes (no more systematic score deflation).
- **feedAlgo:** seen-topics handling is structural (set passed in, no lean-Map bug).
- **ReelAlgo:** completion signal honored (the controller now persists
  `avgWatchPercentage`); cold-start `MIN_QUALITY` lowered to a reachable 0.06.
- **CommentsAlgo:** `MAX_RANK` cap on scored comments; Wilson term decoupled from
  raw engagement magnitude; pattern regexes compiled once.
- **UserAlgo:** `calculateEngagementRate` falls back to a derivable proxy instead
  of reading non-existent `recent*` fields (niche/trending no longer dead).
- **DNAMatchAlgo:** `findTwins` serves precomputed twins, clamps the limit, and
  caps candidates scanned (no full-collection scan per request); weekly job uses
  an `_id` keyset cursor; confidence uses a real interaction count.

'use strict';
/**
 * Eval CLI — run the ranking-quality harness.
 *
 *   node tools/eval                 # baseline report (recency, engagement, native)
 *   node tools/eval --compare       # A/B: native vs baselines
 *   node tools/eval --seed 7        # different synthetic world
 *
 * Pure compute, no DB. Deterministic given --seed.
 */
const { generate } = require('./dataset');
const { evaluate, printReport, printComparison } = require('./runner');
const rankers = require('./rankers');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(name);

function main() {
  const seed = parseInt(arg('--seed', '42'), 10);
  const numUsers = parseInt(arg('--users', '200'), 10);
  const numPosts = parseInt(arg('--posts', '1000'), 10);

  console.log(`Generating synthetic world (seed=${seed}, users=${numUsers}, posts=${numPosts})...`);
  const dataset = generate({ seed, numUsers, numPosts });

  const native = rankers.nativeFeed(dataset.now);
  const retrieveRank = rankers.retrieveThenRank(dataset.now);

  const reports = {
    recency: evaluate(dataset, rankers.recency, { label: 'recency' }),
    engagement: evaluate(dataset, rankers.engagement, { label: 'engagement' }),
    native: evaluate(dataset, native, { label: 'native-feed (C++)' }),
    vectorOnly: evaluate(dataset, rankers.vectorOnly(), { label: 'vector-only (retrieval)' }),
    retrieveRank: evaluate(dataset, retrieveRank, { label: 'retrieve+rank (vector→C++)' }),
  };

  for (const key of Object.keys(reports)) printReport(reports[key]);

  if (has('--compare')) {
    printComparison(reports.native, reports.retrieveRank);
  }

  // Emit machine-readable JSON for the baseline record / CI gating.
  if (has('--json')) {
    console.log('\n' + JSON.stringify(reports, null, 2));
  }
}

main();

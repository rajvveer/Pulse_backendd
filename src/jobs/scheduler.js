/**
 * Background job scheduler.
 *
 * Runs inside the API process when ENABLE_BACKGROUND_JOBS=true, or inside the
 * standalone worker (src/jobs/worker.js). A Redis lock guarantees each job
 * runs on exactly one process per interval, so it is safe under cluster mode.
 */
const cacheService = require('../services/cacheService');
const UserEngagement = require('../models/UserEngagement');
const Session = require('../models/Session');
const DNAMatchAlgo = require('../Algorithms/DNAMatchAlgo');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const JOBS = [
    {
        name: 'engagement-decay',
        intervalMs: DAY,
        lockTtlSec: 6 * 60 * 60, // long enough that a slow run can't double-fire
        run: () => UserEngagement.applyGlobalDecay(),
    },
    {
        name: 'session-cleanup',
        intervalMs: DAY,
        lockTtlSec: 60 * 60,
        run: () => Session.cleanupExpired(),
    },
    {
        name: 'weekly-dna-computation',
        intervalMs: 7 * DAY,
        lockTtlSec: 12 * 60 * 60,
        run: () => DNAMatchAlgo.runWeeklyComputation(),
    },
    {
        // Precompute trending hashtags into Redis so the public endpoint never
        // runs the expensive $unwind/$group aggregation on the request path.
        name: 'trending-hashtags',
        intervalMs: 5 * MINUTE,
        lockTtlSec: 4 * 60, // shorter than the interval — this is cheap & frequent
        run: async () => {
            // Lazy-require to avoid a require cycle (postController → models).
            const { computeTrendingHashtags } = require('../controllers/postController');
            const data = await computeTrendingHashtags();
            const ttl = parseInt(process.env.TRENDING_HASHTAG_TTL_SEC) || 600;
            await cacheService.set('trending:hashtags', data, ttl);
        },
    },
];

// Acquire a distributed lock so only one process executes the job per interval.
// The lock TTL covers the whole interval; it is intentionally never released —
// expiry IS the schedule (lock held = job already ran this interval somewhere).
async function acquireLock(name, intervalMs, lockTtlSec) {
    try {
        const ttl = Math.max(Math.floor(intervalMs / 1000) - 60, lockTtlSec);
        const result = await cacheService.redis.set(`job_lock:${name}`, String(Date.now()), 'EX', ttl, 'NX');
        return result === 'OK';
    } catch (err) {
        // Redis down — skip this tick rather than risk duplicate runs in cluster
        console.warn(`[jobs] Lock check failed for ${name}, skipping tick:`, err.message);
        return false;
    }
}

async function runJob(job) {
    const locked = await acquireLock(job.name, job.intervalMs, job.lockTtlSec);
    if (!locked) return;

    const startedAt = Date.now();
    console.log(`[jobs] Starting ${job.name}...`);
    try {
        await job.run();
        console.log(`[jobs] ${job.name} completed in ${Date.now() - startedAt}ms`);
    } catch (err) {
        console.error(`[jobs] ${job.name} failed:`, err);
    }
}

let timers = [];

function start() {
    if (timers.length > 0) return; // already started

    for (const job of JOBS) {
        // Stagger initial runs so all jobs don't fire at boot simultaneously
        const initialDelay = 60 * 1000 + Math.floor(Math.random() * 4 * 60 * 1000);
        const startTimer = setTimeout(() => runJob(job), initialDelay);
        const interval = setInterval(() => runJob(job), job.intervalMs);
        if (interval.unref) interval.unref();
        if (startTimer.unref) startTimer.unref();
        timers.push(startTimer, interval);
    }

    console.log(`[jobs] Scheduler started with ${JOBS.length} jobs: ${JOBS.map(j => j.name).join(', ')}`);
}

function stop() {
    timers.forEach(t => clearTimeout(t));
    timers = [];
}

module.exports = { start, stop, JOBS, runJob };

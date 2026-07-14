/**
 * Standalone background worker process.
 *
 * Usage: node -r dotenv/config src/jobs/worker.js
 * Runs the same job scheduler as the API (Redis locks prevent double runs if
 * both the API and this worker have jobs enabled).
 */
require('dotenv').config();

const databaseConfig = require('../config/database');
const cacheService = require('../services/cacheService');
const scheduler = require('./scheduler');

async function main() {
    console.log('🛠️  Starting Pulse background worker...');

    await databaseConfig.connect();

    const redisOk = await cacheService.ping();
    if (!redisOk) {
        // Locks need Redis; without it cluster-safe scheduling is impossible
        throw new Error('Redis is required for the background worker');
    }

    scheduler.start();
    console.log('✅ Background worker running');
}

async function shutdown(signal) {
    console.log(`\n🛑 ${signal} received. Shutting down worker...`);
    scheduler.stop();
    await databaseConfig.disconnect();
    await cacheService.disconnect();
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
    console.error('❌ Worker startup failed:', err);
    process.exit(1);
});

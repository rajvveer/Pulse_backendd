'use strict';

const cluster = require('cluster');
const os = require('os');

const WORKER_COUNT = parseInt(process.env.CLUSTER_WORKERS) || os.cpus().length;

if (cluster.isPrimary) {
    let isShuttingDown = false;

    console.log(`\n🏗️  Pulse Cluster Master (PID: ${process.pid})`);
    console.log(`   CPUs available: ${os.cpus().length}`);
    console.log(`   Spawning ${WORKER_COUNT} workers...\n`);

    // Fork workers
    for (let i = 0; i < WORKER_COUNT; i++) {
        cluster.fork();
    }

    // Worker lifecycle events
    cluster.on('online', (worker) => {
        console.log(`✅ Worker ${worker.id} online (PID: ${worker.process.pid})`);
    });

    cluster.on('exit', (worker, code, signal) => {
        if (isShuttingDown) {
            // During shutdown, don't restart — just log
            console.log(`🔌 Worker ${worker.id} exited`);

            // If all workers are gone, exit the master
            if (Object.keys(cluster.workers).length === 0) {
                console.log('👋 All workers exited. Master shutting down.');
                process.exit(0);
            }
            return;
        }

        const reason = signal || `exit code ${code}`;
        console.error(`💀 Worker ${worker.id} died (${reason}). Restarting in 2s...`);

        // Auto-restart with a delay to prevent crash loops
        setTimeout(() => {
            if (!isShuttingDown) cluster.fork();
        }, 2000);
    });

    // Graceful shutdown of all workers
    const shutdown = (signal) => {
        if (isShuttingDown) return; // Prevent double shutdown
        isShuttingDown = true;

        console.log(`\n🛑 ${signal} received. Shutting down all workers...`);
        for (const id in cluster.workers) {
            cluster.workers[id].process.kill(signal);
        }

        // Force exit AFTER the worker's own graceful-drain budget. Each worker
        // (server.js) may take up to SHUTDOWN_FORCE_MS (default 30s) to drain
        // sockets + close deps; the master must outlast that, or it would
        // SIGKILL workers mid-drain. Give a small buffer on top.
        const workerForceMs = parseInt(process.env.SHUTDOWN_FORCE_MS) || 30000;
        setTimeout(() => {
            console.error('⏰ Forced shutdown after worker drain timeout');
            process.exit(1);
        }, workerForceMs + 5000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

} else {
    // Workers run the actual server
    require('./server');
}

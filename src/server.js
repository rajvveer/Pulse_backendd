require('dotenv').config();

// Import configurations first
const config = require('./config');
const databaseConfig = require('./config/database');
const firebaseConfig = require('./config/firebase');
const smtpConfig = require('./config/smtp');
const cacheService = require('./services/cacheService');

const app = require('./app');
const Sentry = require('@sentry/node');
const { createServer } = require('http');
const { Server } = require('socket.io');
const jwtService = require('./services/jwtService');
const { createAdapter } = require('@socket.io/redis-adapter');

// Import the Chat Realtime Handler
const realtimeHandler = require('./sockets/realtime');

const PORT = config.get('server.port');
const NODE_ENV = config.get('server.nodeEnv');

// Print configuration summary
config.printSummary();

// Create HTTP server
const server = createServer(app);

// Allowed origins for Socket.IO (same policy as Express CORS)
const socketAllowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',')
  : ['http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173'];

// Initialize Socket.IO with production-ready settings
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      // Mobile apps don't send Origin — allow them
      if (!origin) return callback(null, true);
      if (socketAllowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'), false);
    },
    methods: ["GET", "POST"],
    credentials: true
  },
  // PING/PONG — reclaim dead sockets faster
  pingTimeout: 20000,     // 20 seconds — detect dead connections sooner
  pingInterval: 25000,    // 25 seconds

  // TRANSPORT — websocket only by default.
  //
  // HTTP long-polling requires every request in a session to land on the SAME
  // process. Across many containers behind a load balancer that means we'd
  // need sticky sessions (cookie / ip-hash) configured at the LB, or polling
  // handshakes fail with "Session ID unknown" and clients churn in a
  // connect/disconnect loop. The mobile client holds one long-lived websocket,
  // so we disable polling entirely and avoid the affinity requirement.
  //
  // If you MUST re-enable polling (e.g. a browser client behind a restrictive
  // proxy), set SOCKET_ENABLE_POLLING=true AND configure LB sticky sessions.
  transports: process.env.SOCKET_ENABLE_POLLING === 'true'
    ? ['websocket', 'polling']
    : ['websocket'],
  allowUpgrades: process.env.SOCKET_ENABLE_POLLING === 'true',

  // CONNECTION SETTINGS
  connectTimeout: 60000,  // 60 second connection timeout

  // BUFFER SETTINGS
  maxHttpBufferSize: 1e6, // 1MB max message size

  // PERFORMANCE — disable per-message compression (let Express handle it)
  perMessageDeflate: false,
  httpCompression: false,

  // RECONNECTION — auto-recover connection state.
  // skipMiddlewares MUST stay false so reconnecting sockets re-run JWT auth
  // (a token may have expired or been revoked during the disconnect window).
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: false,
  },
});

// ✅ Socket.IO Redis Adapter — enables cross-worker event propagation in cluster mode
// Each worker gets its own Socket.IO instance; the adapter syncs events via Redis pub/sub
try {
  const pubClient = cacheService.createClient();
  const subClient = pubClient.duplicate();

  Promise.all([
    new Promise((resolve, reject) => {
      pubClient.on('ready', resolve);
      pubClient.on('error', reject);
    }),
    new Promise((resolve, reject) => {
      subClient.on('ready', resolve);
      subClient.on('error', reject);
    })
  ]).then(() => {
    io.adapter(createAdapter(pubClient, subClient));
    console.log('✅ Socket.IO Redis adapter attached — cluster-safe real-time enabled');
  }).catch((err) => {
    // CRITICAL at scale: without the adapter, events do NOT propagate across
    // workers/containers — a message sent on one instance never reaches a
    // recipient connected to another. This must be loud (and Sentry-reported)
    // rather than a quiet warning, because the app silently half-works.
    const msg = `Socket.IO Redis adapter FAILED — real-time is degraded to in-memory (single-instance only): ${err.message}`;
    console.error(`🚨 ${msg}`);
    if (process.env.SENTRY_DSN) {
      try { Sentry.captureMessage(msg, 'fatal'); } catch { /* noop */ }
    }
  });
} catch (err) {
  const msg = `Socket.IO Redis adapter setup error — real-time may be degraded: ${err.message}`;
  console.error(`🚨 ${msg}`);
  if (process.env.SENTRY_DSN) {
    try { Sentry.captureMessage(msg, 'fatal'); } catch { /* noop */ }
  }
}

// ✅ Socket Authentication Middleware — SECURED
// Reject connections without a valid JWT. The frontend must provide a valid
// access token at connection time. If the token expires, the client should
// disconnect and reconnect with a fresh token (handled by socket.js updateToken).
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    console.warn('⛔ Socket connection rejected — no auth token provided');
    return next(new Error('Authentication required'));
  }

  try {
    // Same verification path as REST: pinned algorithm, issuer, audience,
    // and token type — a refresh or temp token cannot open a socket.
    const decoded = jwtService.verifyAccessToken(token);
    socket.userId = decoded.userId;
    // Cache a lightweight sender profile on the socket so send_message can
    // build its broadcast payload WITHOUT re-reading the message + author
    // from Mongo on every message (see sockets/realtime.js).
    socket.user = {
      _id: decoded.userId,
      username: decoded.username,
      name: decoded.username,
      isVerified: decoded.isVerified,
    };
    next();
  } catch (err) {
    console.warn(`⛔ Socket connection rejected — ${err.message}`);
    return next(new Error('Authentication failed: ' + err.message));
  }
});

// Initialization function
async function initialize() {
  try {
    console.log('🚀 Initializing Pulse Backend Services...\n');

    // 1. Connect to MongoDB
    console.log('📚 Connecting to MongoDB...');
    await databaseConfig.connect();

    // 2. Initialize Redis Cache — required in production (rate limiting,
    // Socket.IO clustering, and caching all depend on it)
    console.log('🔴 Testing Redis connection...');
    const redisHealth = await cacheService.ping();
    if (redisHealth) {
      console.log('✅ Redis connected successfully');
    } else if (config.isProduction()) {
      throw new Error('Redis is unavailable — refusing to start in production');
    } else {
      console.warn('⚠️  Redis connection failed - using fallback cache');
    }

    // 3. Initialize Firebase (optional)
    console.log('🔥 Initializing Firebase...');
    await firebaseConfig.initialize();

    // 4. Initialize SMTP (optional)
    console.log('📧 Initializing SMTP...');
    await smtpConfig.initialize();

    // 5. Create database indexes
    console.log('📝 Creating database indexes...');
    await databaseConfig.createIndexes();

    // 6. Start background jobs (Redis-locked, so safe under cluster mode)
    if (config.get('features.enableBackgroundJobs')) {
      console.log('🛠️  Starting background job scheduler...');
      require('./jobs/scheduler').start();
    }

    console.log('\n✅ All services initialized successfully!\n');

  } catch (error) {
    console.error('❌ Service initialization failed:', error);

    if (config.isProduction()) {
      console.error('🚨 Exiting due to initialization failure in production');
      process.exit(1);
    } else {
      console.warn('⚠️  Continuing with limited functionality in development');
    }
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  // Always join the user's own room so server-side code can target a specific
  // user (notifications, etc.) regardless of which worker they're on.
  if (socket.userId) socket.join(`user_${socket.userId}`);

  // Attach the Real-Time Chat Logic (join_conversation, send_message, typing,
  // presence...). Presence is Redis-backed and scoped to conversation peers
  // inside this handler — there is intentionally NO global io.emit anywhere.
  realtimeHandler(io, socket);

  // Real-time features for social app.
  // Only allow well-known public room patterns here — conversation rooms must
  // go through the membership-checked join_conversation handler in realtime.js.
  const isJoinableRoom = (room) =>
    typeof room === 'string' &&
    (/^location_-?\d+_-?\d+$/.test(room) || room === `user_${socket.userId}`);

  socket.on('join-room', (room) => {
    if (!isJoinableRoom(room)) return;
    socket.join(room);
  });

  socket.on('leave-room', (room) => {
    if (typeof room !== 'string') return;
    socket.leave(room);
  });

  // Location-based room joining
  socket.on('join-location', (location) => {
    if (!location?.lat || !location?.lng) return;
    const locationRoom = `location_${Math.round(location.lat * 1000)}_${Math.round(location.lng * 1000)}`;
    socket.join(locationRoom);
  });
});

// Make io accessible to routes
app.set('socketio', io);

// Event-loop lag sampler — the key saturation signal for this workload (feed
// ranking + frame serialization are synchronous). We measure how late a 1s
// timer actually fires; sustained lag means the loop is overloaded.
let eventLoopLagMs = 0;
{
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    eventLoopLagMs = Math.max(0, now - last - 1000);
    last = now;
  }, 1000);
  timer.unref?.();
}

// Readiness state — flipped to false on SIGTERM so the load balancer drains
// this instance BEFORE we start tearing down connections (see graceful
// shutdown below).
let isShuttingDown = false;

// Liveness probe — is the process up? (Used by Docker HEALTHCHECK.) Cheap and
// dependency-free: a hung event loop won't answer, which is exactly what
// liveness should detect.
app.get('/health', (req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({ status: 'SHUTTING_DOWN' });
  }
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Pulse Backend API',
    version: '1.0.0',
    environment: NODE_ENV
  });
});

// Readiness probe — should the LB route traffic here RIGHT NOW? Checks the
// critical dependencies (Mongo + Redis) with a short timeout and caches the
// result for a few seconds so a probe storm can't hammer the DB. Returns 503
// when a dependency is down (LB stops routing) or during shutdown drain.
let readyCache = { at: 0, ok: false, body: null };
const READY_CACHE_MS = 3000;
const withTimeout = (p, ms) =>
  Promise.race([
    Promise.resolve(p),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);

app.get('/health/ready', async (req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({ status: 'SHUTTING_DOWN', ready: false });
  }

  const now = Date.now();
  if (readyCache.body && now - readyCache.at < READY_CACHE_MS) {
    return res.status(readyCache.ok ? 200 : 503).json(readyCache.body);
  }

  const [db, redis] = await Promise.all([
    withTimeout(databaseConfig.isHealthy(), 1000).catch(() => false),
    withTimeout(cacheService.ping(), 1000).catch(() => false),
  ]);

  const ok = db === true && redis === true;
  const body = {
    status: ok ? 'READY' : 'NOT_READY',
    ready: ok,
    services: { database: db === true, redis: redis === true },
    timestamp: new Date().toISOString(),
  };
  readyCache = { at: now, ok, body };
  res.status(ok ? 200 : 503).json(body);
});

// Guard for introspection endpoints: open in development, but in production
// they expose infrastructure details, so require a shared key header.
const internalOnly = (req, res, next) => {
  if (!config.isProduction()) return next();
  const key = process.env.INTERNAL_STATUS_KEY;
  if (key && req.headers['x-internal-key'] === key) return next();
  return res.status(404).json({ success: false, message: 'Not found' });
};

// Prometheus-style metrics endpoint (text exposition format). Surfaces the
// saturation signals an HPA / scraper needs: event-loop lag, live socket count,
// memory, and uptime. Gated by internalOnly so it isn't public. If you later
// add prom-client, swap this for its registry — the metric names are aligned.
app.get('/metrics', internalOnly, (req, res) => {
  const mem = process.memoryUsage();
  const lines = [
    '# HELP pulse_event_loop_lag_ms Event loop lag in milliseconds',
    '# TYPE pulse_event_loop_lag_ms gauge',
    `pulse_event_loop_lag_ms ${eventLoopLagMs}`,
    '# HELP pulse_socket_connections Currently connected Socket.IO clients (this instance)',
    '# TYPE pulse_socket_connections gauge',
    `pulse_socket_connections ${io.engine?.clientsCount || 0}`,
    '# HELP pulse_socket_rooms Active Socket.IO rooms (this instance)',
    '# TYPE pulse_socket_rooms gauge',
    `pulse_socket_rooms ${io.sockets?.adapter?.rooms?.size || 0}`,
    '# HELP pulse_memory_heap_used_bytes Process heap used',
    '# TYPE pulse_memory_heap_used_bytes gauge',
    `pulse_memory_heap_used_bytes ${mem.heapUsed}`,
    '# HELP pulse_memory_rss_bytes Process resident set size',
    '# TYPE pulse_memory_rss_bytes gauge',
    `pulse_memory_rss_bytes ${mem.rss}`,
    '# HELP pulse_uptime_seconds Process uptime',
    '# TYPE pulse_uptime_seconds counter',
    `pulse_uptime_seconds ${Math.floor(process.uptime())}`,
  ];
  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.send(lines.join('\n') + '\n');
});

// Detailed health check endpoint with full system information
app.get('/health/detailed', internalOnly, async (req, res) => {
  try {
    const startTime = Date.now();

    // Test all services
    const [databaseHealth, redisHealth] = await Promise.allSettled([
      databaseConfig.isHealthy(),
      cacheService.ping()
    ]);

    const health = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      responseTime: `${Date.now() - startTime}ms`,

      // Service health checks
      services: {
        database: databaseHealth.status === 'fulfilled' ? databaseHealth.value : false,
        redis: redisHealth.status === 'fulfilled' ? redisHealth.value : false,
        firebase: firebaseConfig.isAvailable(),
        smtp: smtpConfig.isAvailable()
      },

      // Application info
      application: {
        name: 'Pulse Backend API',
        version: '1.0.0',
        environment: NODE_ENV,
        nodeVersion: process.version,
        uptime: Math.floor(process.uptime()),
        startTime: new Date(Date.now() - process.uptime() * 1000).toISOString()
      },

      // System info
      system: {
        platform: process.platform,
        arch: process.arch,
        memory: {
          used: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
          total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
          external: `${Math.round(process.memoryUsage().external / 1024 / 1024)}MB`
        },
        cpu: {
          usage: process.cpuUsage()
        }
      },

      // Database info (if connected)
      database: databaseConfig.getConnectionStats(),

      // Redis info (if connected)  
      redis: redisHealth.status === 'fulfilled' && redisHealth.value ?
        await cacheService.getStats().catch(() => ({ error: 'Stats unavailable' })) :
        { connected: false },

      // Socket.io info
      socketio: {
        connected: io.engine.clientsCount,
        rooms: io.sockets.adapter.rooms.size
      },

      // Configuration summary
      config: {
        cors: config.get('cors.origin'),
        rateLimit: {
          windowMs: config.get('rateLimit.windowMs'),
          maxRequests: config.get('rateLimit.maxRequests')
        },
        features: {
          emailOTP: !!config.get('otp.email'),
          smsOTP: !!config.get('otp.smsGatewayUrl'),
          firebase: !!config.get('firebase.projectId'),
          cloudinary: !!config.get('media.cloudinary.cloudName')
        }
      }
    };

    // Determine overall health status
    const criticalServices = [health.services.database, health.services.redis];
    const allCriticalHealthy = criticalServices.every(status => status === true);
    const overallStatus = allCriticalHealthy ? 'OK' : 'DEGRADED';

    health.status = overallStatus;

    res.status(allCriticalHealthy ? 200 : 503).json(health);

  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      error: error.message,
      service: 'Pulse Backend API'
    });
  }
});

// API status endpoint
app.get('/status', internalOnly, (req, res) => {
  res.json({
    api: 'Pulse Backend',
    version: '1.0.0',
    status: 'active',
    endpoints: {
      health: '/health',
      detailedHealth: '/health/detailed',
      auth: '/api/v1/auth',
      documentation: '/api/docs'
    },
    features: [
      'Multi-method authentication (Email, Phone, Google)',
      'Real-time Socket.IO support',
      'Redis caching',
      'MongoDB with geospatial indexing',
      'JWT + Refresh token system',
      'Rate limiting and security',
      'Email OTP verification',
      'User session management'
    ],
    timestamp: new Date().toISOString()
  });
});

// Start server after initialization
async function startServer() {
  try {
    // Initialize all services
    await initialize();

    // HTTP timeouts — protect against slow-loris / stuck connections holding
    // sockets open. keepAliveTimeout must be < headersTimeout, and both should
    // exceed the load balancer's idle timeout to avoid 502s on reused conns.
    server.keepAliveTimeout = parseInt(process.env.HTTP_KEEPALIVE_TIMEOUT_MS) || 65000;
    server.headersTimeout = parseInt(process.env.HTTP_HEADERS_TIMEOUT_MS) || 66000;
    server.requestTimeout = parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS) || 30000;

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`🚀 Pulse Backend Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${NODE_ENV}`);
      console.log(`🔗 API URL: http://localhost:${PORT}`);
      console.log(`📋 Health Check: http://localhost:${PORT}/health`);
      console.log(`📊 Detailed Health: http://localhost:${PORT}/health/detailed`);
      console.log(`🔧 API Status: http://localhost:${PORT}/status`);
      console.log(`🔑 Auth API: http://localhost:${PORT}/api/v1/auth/test`);
      console.log(`\n🎯 Ready for connections!`);
      console.log(`📱 Socket.IO ready for real-time features`);
      console.log(`🗄️  Database: ${databaseConfig.isConnected ? '✅' : '❌'}`);
      console.log(`🔴 Redis: ${cacheService.isConnected ? '✅' : '❌'}`);
    });

  } catch (error) {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
}

// Graceful shutdown — single implementation shared by SIGTERM/SIGINT.
//
// Order matters at 100K scale to avoid a synchronized reconnect storm:
//   1. Flip readiness to 503 so the LB stops routing NEW traffic here.
//   2. Wait a short grace period for the LB to actually deregister us.
//   3. Tell connected sockets to reconnect (with client-side jitter) and
//      disconnect them gracefully, rather than yanking them all at once.
//   4. Stop accepting new HTTP, then close dependencies.
let shuttingDownAlready = false;
async function gracefulShutdown(signal) {
  if (shuttingDownAlready) return;
  shuttingDownAlready = true;
  isShuttingDown = true; // /health and /health/ready now return 503
  console.log(`\n🛑 ${signal} received. Draining...`);

  const DRAIN_MS = parseInt(process.env.SHUTDOWN_DRAIN_MS) || 5000;
  const FORCE_MS = parseInt(process.env.SHUTDOWN_FORCE_MS) || 30000;

  // Hard cap — never hang forever.
  const forceTimer = setTimeout(() => {
    console.error('⏰ Forced shutdown after timeout');
    process.exit(1);
  }, FORCE_MS);
  forceTimer.unref?.();

  try {
    // 2. Let the LB notice we're unready before we cut connections.
    await new Promise((r) => setTimeout(r, DRAIN_MS));

    // 3. Ask clients to reconnect elsewhere (the client should add random
    //    backoff so a whole pod's worth of sockets don't reconnect in lockstep).
    try {
      io.emit('server_shutdown', { reconnectInMs: 1000 + Math.floor(Math.random() * 4000) });
      io.disconnectSockets(true);
    } catch (e) {
      console.warn('Socket drain warning:', e.message);
    }

    // 4. Stop accepting new connections, then tear down dependencies.
    await new Promise((resolve) => server.close(resolve));
    console.log('🔌 HTTP server closed');

    await new Promise((resolve) => io.close(resolve));
    console.log('📡 Socket.IO server closed');

    await databaseConfig.disconnect();
    await cacheService.disconnect();
    await smtpConfig.close();

    clearTimeout(forceTimer);
    console.log('👋 Graceful shutdown completed');
    process.exit(0);
  } catch (err) {
    console.error('Shutdown error:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);

  if (config.isProduction()) {
    console.error('🚨 Exiting due to uncaught exception in production');
    process.exit(1);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚫 Unhandled Rejection at:', promise, 'reason:', reason);

  if (config.isProduction()) {
    console.error('🚨 Exiting due to unhandled rejection in production');
    process.exit(1);
  }
});

// Start the server
startServer().catch(console.error);
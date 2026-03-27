require('dotenv').config();

// Import configurations first
const config = require('./config');
const databaseConfig = require('./config/database');
const firebaseConfig = require('./config/firebase');
const smtpConfig = require('./config/smtp');
const cacheService = require('./services/cacheService');

const app = require('./app');
const { createServer } = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { createAdapter } = require('@socket.io/redis-adapter');

// Import the Chat Realtime Handler
const realtimeHandler = require('./sockets/realtime');

const PORT = config.get('server.port');
const NODE_ENV = config.get('server.nodeEnv');

// Print configuration summary
config.printSummary();

// Create HTTP server
const server = createServer(app);

// Initialize Socket.IO with production-ready settings
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins — required for mobile app connections
    methods: ["GET", "POST"],
    credentials: false // Must be false when origin is '*'
  },
  // PING/PONG — reclaim dead sockets faster
  pingTimeout: 20000,     // 20 seconds — detect dead connections sooner
  pingInterval: 25000,    // 25 seconds

  // TRANSPORT — prefer websocket, fallback to polling
  transports: ['websocket', 'polling'],
  allowUpgrades: true,

  // CONNECTION SETTINGS
  connectTimeout: 60000,  // 60 second connection timeout

  // BUFFER SETTINGS
  maxHttpBufferSize: 1e6, // 1MB max message size

  // PERFORMANCE — disable per-message compression (let Express handle it)
  perMessageDeflate: false,
  httpCompression: false,

  // RECONNECTION — auto-recover connection state
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
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
    console.warn('⚠️  Socket.IO Redis adapter failed — falling back to in-memory (single-worker only):', err.message);
  });
} catch (err) {
  console.warn('⚠️  Socket.IO Redis adapter setup error:', err.message);
}

// ✅ Socket Authentication Middleware
// Tries to verify the token, but allows connection even if token is expired.
// The 'user-online' event will set socket.userId with a fresh identity.
io.use((socket, next) => {
  if (socket.handshake.auth && socket.handshake.auth.token) {
    try {
      const token = socket.handshake.auth.token;
      const decoded = jwt.verify(token, config.get('jwt.secret') || process.env.JWT_SECRET);
      socket.userId = decoded.userId;
    } catch (err) {
      // ✅ FIX: Don't reject the connection — allow it without userId.
      // The 'user-online' event will identify the user once the app
      // refreshes its HTTP token and re-emits 'user-online'.
      console.warn('Socket Auth Warning:', err.message, '— allowing connection without userId');
    }
  }
  next();
});

// Initialization function
async function initialize() {
  try {
    console.log('🚀 Initializing Pulse Backend Services...\n');

    // 1. Connect to MongoDB
    console.log('📚 Connecting to MongoDB...');
    await databaseConfig.connect();

    // 2. Initialize Redis Cache
    console.log('🔴 Testing Redis connection...');
    const redisHealth = await cacheService.ping();
    if (redisHealth) {
      console.log('✅ Redis connected successfully');
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
  console.log(`👤 User connected: ${socket.id} ${socket.userId ? `(ID: ${socket.userId})` : ''}`);

  // ✅ ADDED: Attach the Real-Time Chat Logic here
  // This enables join_conversation, send_message, typing_start, etc.
  realtimeHandler(io, socket);

  socket.on('disconnect', () => {
    console.log(`👋 User disconnected: ${socket.id}`);
  });

  // Real-time features for social app
  socket.on('join-room', (room) => {
    socket.join(room);
    console.log(`📍 User ${socket.id} joined room: ${room}`);
  });

  socket.on('leave-room', (room) => {
    socket.leave(room);
    console.log(`🚪 User ${socket.id} left room: ${room}`);
  });

  // Location-based room joining
  socket.on('join-location', (location) => {
    const locationRoom = `location_${Math.round(location.lat * 1000)}_${Math.round(location.lng * 1000)}`;
    socket.join(locationRoom);
    console.log(`📍 User ${socket.id} joined location: ${locationRoom}`);
  });

  // User presence
  socket.on('user-online', (userId) => {
    socket.userId = userId;
    socket.join(`user_${userId}`);
    io.emit('user-status', { userId, status: 'online' });
  });

  socket.on('user-typing', (data) => {
    socket.to(data.room).emit('user-typing', {
      userId: socket.userId,
      isTyping: data.isTyping
    });
  });
});

// Make io accessible to routes
app.set('socketio', io);

// Enhanced health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Pulse Backend API',
    version: '1.0.0',
    environment: NODE_ENV
  });
});

// Detailed health check endpoint with full system information
app.get('/health/detailed', async (req, res) => {
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
app.get('/status', (req, res) => {
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

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM received. Shutting down gracefully...');

  server.close(async () => {
    console.log('🔌 HTTP server closed');

    // Close Socket.IO
    io.close(() => {
      console.log('📡 Socket.IO server closed');
    });

    // Close database connection
    await databaseConfig.disconnect();

    // Close Redis connection
    await cacheService.disconnect();

    // Close SMTP connection
    await smtpConfig.close();

    console.log('👋 Graceful shutdown completed');
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('⏰ Forced shutdown after 30 seconds');
    process.exit(1);
  }, 30000);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 SIGINT received. Shutting down gracefully...');

  server.close(async () => {
    console.log('🔌 HTTP server closed');

    // Close Socket.IO
    io.close(() => {
      console.log('📡 Socket.IO server closed');
    });

    // Close database connection
    await databaseConfig.disconnect();

    // Close Redis connection
    await cacheService.disconnect();

    // Close SMTP connection  
    await smtpConfig.close();

    console.log('👋 Graceful shutdown completed');
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('⏰ Forced shutdown after 30 seconds');
    process.exit(1);
  }, 30000);
});

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
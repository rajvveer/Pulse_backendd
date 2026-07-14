const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const crypto = require('crypto');
const Sentry = require('@sentry/node');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const logger = require('./utils/logger');
const { globalLimiter } = require('./middlewares/rateLimit');
const { sanitizeBody } = require('./middlewares/sanitize');

// Initialize Sentry for production error tracking
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  });
  console.log('✅ Sentry error tracking initialized');
}
const app = express();

// Trust proxy — number of hops between the client and this process (LB +
// ingress + platform router can be >1). Set TRUST_PROXY_HOPS to match your
// actual topology: too low makes req.ip the proxy's IP (everyone shares one
// rate-limit bucket); too high lets clients spoof X-Forwarded-For to evade
// IP-based limits. Default 1 (single platform proxy, e.g. Railway/Heroku).
app.set('trust proxy', parseInt(process.env.TRUST_PROXY_HOPS) || 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" } // Allow cross-origin requests
}));

// Debug logger removed to reduce terminal noise

// CORS configuration — secure for production
// Mobile apps don't send Origin headers, so they pass through naturally.
// Web origins are checked against a whitelist to prevent cross-site attacks.
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',')
  : ['http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://localhost:3100', 'http://127.0.0.1:3100'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin — this is how mobile apps (React Native) work.
    // Native HTTP clients don't send the Origin header, so this is safe.
    if (!origin) return callback(null, true);

    // Check web origins against whitelist
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Reject unknown web origins
    logger.warn(`CORS blocked request from origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin']
}));

// Ensure OPTIONS requests are answered immediately handled by the cors() middleware above

app.use(compression());

// Global rate limiter — 200 req / 15 min per IP
app.use(globalLimiter);

// Logging middleware
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('short'));
} else if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// Body parsing middleware. Media uploads go through multer (multipart), NOT
// JSON, so the JSON limit can be small — a 10MB JSON body × high concurrency
// is a memory + sanitize-cost amplifier. 256KB is ample for posts/comments/
// profile payloads (override with JSON_BODY_LIMIT if a route needs more).
const JSON_LIMIT = process.env.JSON_BODY_LIMIT || '256kb';
app.use(express.json({ limit: JSON_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_LIMIT }));

// XSS Sanitization — clean all user input to prevent stored XSS attacks
app.use(sanitizeBody);

// Pagination cap — prevent clients from requesting absurd page sizes
app.use((req, res, next) => {
  if (req.query.limit) {
    const parsed = parseInt(req.query.limit);
    req.query.limit = String(Math.min(Math.max(parsed || 20, 1), 100));
  }
  next();
});

// Request metadata middleware
app.use((req, res, next) => {
  req.timestamp = new Date();
  req.requestId = crypto.randomBytes(8).toString('hex');
  next();
});

// Production safety net: many controllers return `error.message` in 500
// responses, which can leak Mongoose/internal details. Scrub all 5xx JSON
// bodies centrally so nothing internal reaches clients in production.
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 500) {
        return originalJson({
          success: false,
          error: 'An unexpected internal server error occurred.',
          code: (body && typeof body === 'object' && body.code) || 'INTERNAL_ERROR',
          requestId: req.requestId
        });
      }
      return originalJson(body);
    };
    next();
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Pulse Backend API',
    version: '1.0.0'
  });
});

// --- API Routes ---
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/users', require('./routes/users'));
app.use('/api/v1/posts', require('./routes/posts'));
app.use('/api/v1/feed', require('./routes/feed.js'));
app.use('/api/v1/chat', require('./routes/chatRoutes'));
app.use('/api/v1/media', require('./routes/media'));
app.use('/api/v1/gifs', require('./routes/gifs'));
app.use('/api/v1/reels', require('./routes/reelRoutes'));
app.use('/api/v1/snaps', require('./routes/snapRoutes'));
app.use('/api/v1/groups', require('./routes/groupRoutes'));

// NEW FEATURE ROUTES
app.use('/api/v1/admin', require('./routes/adminRoutes'));
app.use('/api/v1/whispers', require('./routes/whisperRoutes'));
app.use('/api/v1/pulse-drops', require('./routes/pulseDropRoutes'));
app.use('/api/v1/chains', require('./routes/chainRoutes'));
app.use('/api/v1/alter-ego', require('./routes/alterEgoRoutes'));
app.use('/api/v1/notifications', require('./routes/notificationRoutes'));
app.use('/api/v1/push', require('./routes/pushRoutes'));
app.use('/api/v1/social-dna', require('./routes/socialDNARoutes'));
app.use('/api/v1/pulse-score', require('./routes/pulseScoreRoutes'));
app.use('/api/v1/roulette', require('./routes/rouletteRoutes'));
app.use('/api/v1/bookmarks', require('./routes/bookmarkRoutes'));
app.use('/api/v1/referral', require('./routes/referralRoutes'));

// Open Graph share routes (public — no auth, crawlers need access)
app.use('/share', require('./routes/ogRoutes'));

// Swagger API Documentation (available at /api-docs).
// Hidden in production unless ENABLE_API_DOCS=true — the full API surface is
// useful reconnaissance for attackers.
const apiDocsEnabled = process.env.NODE_ENV !== 'production' || process.env.ENABLE_API_DOCS === 'true';
if (apiDocsEnabled) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Pulse API Documentation'
  }));
  // JSON spec endpoint for tooling
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}
// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: 'Route not found. The requested endpoint does not exist.',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Report errors to Sentry before the custom handler formats the response
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// Global error handler
app.use((error, req, res, next) => {
  logger.error(`[${req.requestId || 'unknown'}] Global Error:`, error);

  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      error: 'Validation failed. Please check your input.',
      details: errors,
      code: 'VALIDATION_ERROR'
    });
  }

  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      error: `A record with that ${field} already exists.`,
      code: 'DUPLICATE_ERROR'
    });
  }

  const status = error.status || 500;
  // Never leak internal error messages on 5xx in production
  const safeMessage = (status >= 500 && process.env.NODE_ENV === 'production')
    ? 'An unexpected internal server error occurred.'
    : (error.message || 'An unexpected internal server error occurred.');

  res.status(status).json({
    success: false,
    error: safeMessage,
    code: error.code || 'INTERNAL_ERROR',
    requestId: req.requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

module.exports = app;
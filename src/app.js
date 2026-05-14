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

app.set('trust proxy', 1); // Trust 1 proxy hop (Railway/Heroku). Avoids rate-limit bypass via IP spoofing.

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
  : ['http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173'];

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

// Body parsing middleware (10MB — media uploads go through multer/Cloudinary)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
app.use('/api/v1/groups', require('./routes/groupRoutes'));

// NEW FEATURE ROUTES
// app.use('/api/v1/admin', require('./routes/adminRoutes'));
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

// Swagger API Documentation (available at /api-docs)
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Pulse API Documentation'
}));
// JSON spec endpoint for tooling
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});
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

  res.status(error.status || 500).json({
    success: false,
    error: error.message || 'An unexpected internal server error occurred.',
    code: error.code || 'INTERNAL_ERROR',
    requestId: req.requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

module.exports = app;
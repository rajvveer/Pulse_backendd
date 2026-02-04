const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const crypto = require('crypto');

const app = express();

app.set('trust proxy', 'loopback');

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  credentials: true
}));

app.use(compression());

// Logging middleware
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
app.use('/api/v1/whispers', require('./routes/whisperRoutes'));
app.use('/api/v1/pulse-drops', require('./routes/pulseDropRoutes'));
app.use('/api/v1/chains', require('./routes/chainRoutes'));
app.use('/api/v1/alter-ego', require('./routes/alterEgoRoutes'));


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
  console.error(`[${req.requestId || 'unknown'}] Global Error:`, error);

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
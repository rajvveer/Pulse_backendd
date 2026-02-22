const rateLimit = require('express-rate-limit');

/**
 * Global rate limiter — applied to all routes.
 * 200 requests per 15 minutes per IP.
 * Generous enough for mobile apps doing feed scrolling + API calls.
 */
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200,
    standardHeaders: true,   // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false,    // Disable `X-RateLimit-*` headers
    message: {
        success: false,
        error: 'Too many requests. Please slow down and try again later.',
        code: 'RATE_LIMIT_EXCEEDED'
    },
    // Skip rate limiting for health check endpoints
    skip: (req) => req.path === '/health' || req.path === '/health/detailed' || req.path === '/status',
});

/**
 * Strict limiter for auth-related endpoints.
 * 20 requests per 15 minutes per IP.
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many authentication attempts. Please try again later.',
        code: 'AUTH_RATE_LIMIT_EXCEEDED'
    },
});

/**
 * Strict limiter for media upload endpoints.
 * 30 uploads per 15 minutes per IP.
 */
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many uploads. Please try again later.',
        code: 'UPLOAD_RATE_LIMIT_EXCEEDED'
    },
});

module.exports = {
    globalLimiter,
    authLimiter,
    uploadLimiter,
};

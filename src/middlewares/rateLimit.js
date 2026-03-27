const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const cacheService = require('../services/cacheService');

// Shared Redis store — all workers share the same counters
const redisStore = new RedisStore({
    sendCommand: (...args) => cacheService.redis.call(...args),
});

/**
 * Global rate limiter — applied to all routes.
 * 200 requests per 15 minutes per IP.
 */
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore,
    message: {
        success: false,
        error: 'Too many requests. Please slow down and try again later.',
        code: 'RATE_LIMIT_EXCEEDED'
    },
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
    store: new RedisStore({
        sendCommand: (...args) => cacheService.redis.call(...args),
        prefix: 'rl:auth:',
    }),
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
    store: new RedisStore({
        sendCommand: (...args) => cacheService.redis.call(...args),
        prefix: 'rl:upload:',
    }),
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

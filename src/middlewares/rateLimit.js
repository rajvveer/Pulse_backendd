const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const cacheService = require('../services/cacheService');

// All limiters share Redis so counters are correct across cluster workers.
// passOnStoreError lets requests through during a transient Redis outage
// instead of returning 500 for every request (availability over strictness;
// production startup already refuses to boot without Redis).
const makeStore = (prefix) => new RedisStore({
    sendCommand: (...args) => cacheService.redis.call(...args),
    prefix,
});

// Key authenticated requests by USER, not IP. The app's audience is Indian
// mobile (Jio/Airtel CGNAT) where tens of thousands of real users egress from
// a handful of IPs — an IP-keyed global limit would let one user's traffic
// throttle everyone else sharing that NAT (self-inflicted mass 429s). When a
// request is authenticated we already know the user; fall back to IP only for
// anonymous traffic.
const keyByUserOrIp = (req) => {
    if (req.user && req.user.userId) return `u:${req.user.userId}`;
    // ipKeyGenerator normalizes IPv6 (collapses to a /64 subnet) so v6 clients
    // can't trivially rotate addresses to bypass the limit.
    return `ip:${ipKeyGenerator(req.ip)}`;
};

const skipHealth = (req) =>
    req.path === '/health' ||
    req.path === '/health/ready' ||
    req.path === '/health/detailed' ||
    req.path === '/status';

/**
 * Global rate limiter — applied to all routes.
 *
 * Keyed per-user for authenticated traffic (per-IP only for anonymous), with a
 * generous ceiling: a legitimate user scrolling feeds + chatting makes many
 * requests/minute, so 200/15min/IP (≈13/min) was far too low once shared
 * across a CGNAT. Default is now per-user and higher.
 */
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByUserOrIp,
    store: makeStore('rl:global:'),
    passOnStoreError: true,
    message: {
        success: false,
        error: 'Too many requests. Please slow down and try again later.',
        code: 'RATE_LIMIT_EXCEEDED'
    },
    skip: skipHealth,
});

/**
 * Strict limiter for auth-related endpoints (pre-auth, so keyed by IP).
 *
 * Ceiling raised for CGNAT: many distinct real users log in from one carrier
 * IP. Per-credential brute-force protection comes from the account lockout in
 * the User model (loginAttempts/lockUntil), not this coarse IP gate. Tune via
 * AUTH_RATE_LIMIT_MAX.
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 100,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore('rl:auth:'),
    passOnStoreError: true,
    message: {
        success: false,
        error: 'Too many authentication attempts. Please try again later.',
        code: 'AUTH_RATE_LIMIT_EXCEEDED'
    },
});

/**
 * Limiter for OTP request endpoints (send/resend), keyed by IP.
 *
 * Raised from 5 → 30/15min/IP so a shared CGNAT doesn't lock out real users.
 * The real abuse/cost control is PER-IDENTIFIER (per phone/email) in
 * customOTPService.checkRateLimit + the global SMS budget below — those cap
 * spend regardless of source IP.
 */
const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.OTP_RATE_LIMIT_MAX) || 30,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore('rl:otp:'),
    passOnStoreError: true,
    message: {
        success: false,
        error: 'Too many OTP requests, please try again later',
        code: 'OTP_RATE_LIMIT_EXCEEDED'
    },
});

/**
 * Limiter for token refresh — generous (clients refresh every ~15 min)
 * but bounded to stop brute-force replay of refresh tokens.
 */
const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore('rl:refresh:'),
    passOnStoreError: true,
    message: {
        success: false,
        error: 'Too many token refresh attempts. Please try again later.',
        code: 'REFRESH_RATE_LIMIT_EXCEEDED'
    },
});

/**
 * Strict limiter for media upload endpoints.
 * 30 uploads per 15 minutes per IP.
 */
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.UPLOAD_RATE_LIMIT_MAX) || 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByUserOrIp, // uploads are authenticated → key by user
    store: makeStore('rl:upload:'),
    passOnStoreError: true,
    message: {
        success: false,
        error: 'Too many uploads. Please try again later.',
        code: 'UPLOAD_RATE_LIMIT_EXCEEDED'
    },
});

module.exports = {
    globalLimiter,
    authLimiter,
    otpLimiter,
    refreshLimiter,
    uploadLimiter,
};

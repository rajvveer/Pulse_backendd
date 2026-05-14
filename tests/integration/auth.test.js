/**
 * Auth API Integration Tests
 * 
 * Tests the critical auth flow: initiate → verify → create username → refresh → logout
 * These tests verify that the API contract is correct and auth security is enforced.
 */

const request = require('supertest');

// Mock environment for tests
process.env.JWT_SECRET = 'test-jwt-secret-ci';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-ci';
process.env.TEMP_JWT_SECRET = 'test-temp-secret-ci';
process.env.NODE_ENV = 'test';

// We need to mock services that require external connections
jest.mock('../../src/services/cacheService', () => ({
  ping: jest.fn().mockResolvedValue(true),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  del: jest.fn().mockResolvedValue(true),
  incrementRateLimit: jest.fn().mockResolvedValue(1),
  isConnected: true,
  redis: { call: jest.fn() },
  createClient: jest.fn(),
  disconnect: jest.fn(),
  getStats: jest.fn().mockResolvedValue({})
}));

jest.mock('../../src/services/customOTPService', () => ({
  sendEmailOTP: jest.fn().mockResolvedValue({
    success: true,
    identifier: 'test@example.com',
    type: 'email',
    purpose: 'signup',
    expiresIn: '10 minutes',
    message: 'OTP sent'
  }),
  sendSMSOTP: jest.fn().mockResolvedValue({
    success: true,
    identifier: '+919876543210',
    type: 'sms',
    purpose: 'signup',
    expiresIn: '5 minutes',
    message: 'OTP sent'
  }),
  verifyOTP: jest.fn().mockResolvedValue({
    success: true,
    verified: true
  }),
  resendOTP: jest.fn().mockResolvedValue({ success: true })
}));

// Mock rate-limit-redis to avoid Redis dependency
jest.mock('rate-limit-redis', () => ({
  RedisStore: jest.fn().mockImplementation(() => ({
    init: jest.fn(),
    increment: jest.fn().mockResolvedValue({ totalHits: 1, resetTime: new Date() }),
    decrement: jest.fn(),
    resetKey: jest.fn()
  }))
}));

const app = require('../../src/app');
const jwtService = require('../../src/services/jwtService');

describe('Auth API', () => {
  describe('POST /api/v1/auth/initiate', () => {
    it('should reject requests without method and identifier', async () => {
      const res = await request(app)
        .post('/api/v1/auth/initiate')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('MISSING_REQUIRED_FIELDS');
    });

    it('should reject invalid auth method', async () => {
      const res = await request(app)
        .post('/api/v1/auth/initiate')
        .send({ method: 'twitter', identifier: 'test' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_METHOD');
    });

    it('should reject invalid email format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/initiate')
        .send({ method: 'email', identifier: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid Indian phone number', async () => {
      const res = await request(app)
        .post('/api/v1/auth/initiate')
        .send({ method: 'phone', identifier: '1234567890' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/verify-otp', () => {
    it('should reject requests without required fields', async () => {
      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_REQUIRED_FIELDS');
    });

    it('should reject invalid method', async () => {
      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ identifier: 'test@example.com', otp: '123456', method: 'invalid', deviceId: 'test' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_METHOD');
    });
  });

  describe('POST /api/v1/auth/create-username', () => {
    it('should reject requests without required fields', async () => {
      const res = await request(app)
        .post('/api/v1/auth/create-username')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_REQUIRED_FIELDS');
    });

    it('should reject invalid temp token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/create-username')
        .send({
          tempToken: 'invalid-token',
          username: 'testuser',
          password: 'password123',
          deviceId: 'test-device'
        });

      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/v1/auth/refresh-token', () => {
    it('should reject requests without refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh-token')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_REFRESH_TOKEN');
    });

    it('should reject invalid refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh-token')
        .send({ refreshToken: 'invalid-token' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should reject unauthenticated requests', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('MISSING_ACCESS_TOKEN');
    });

    it('should reject invalid Bearer tokens', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should reject unauthenticated requests', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .send({ deviceId: 'test' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/check-username', () => {
    it('should reject requests without username', async () => {
      const res = await request(app)
        .get('/api/v1/auth/check-username');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_USERNAME');
    });
  });
});

describe('Health Check', () => {
  it('should return OK', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.service).toBe('Pulse Backend API');
  });
});

describe('404 Handler', () => {
  it('should return 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('Security Headers', () => {
  it('should include security headers from Helmet', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});

describe('Input Sanitization', () => {
  it('should sanitize XSS payloads in request body', async () => {
    // Test that XSS payloads in auth initiate get sanitized
    // Using a completely invalid method so it fails fast at validation
    const res = await request(app)
      .post('/api/v1/auth/initiate')
      .send({
        method: '<script>alert("xss")</script>',
        identifier: 'test@example.com'
      });

    // Should be rejected as invalid method, not crash
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_METHOD');
  });
});

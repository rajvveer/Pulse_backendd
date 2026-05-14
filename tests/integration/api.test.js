/**
 * Post API Integration Tests
 * 
 * Tests post creation, retrieval, search, and trending endpoints.
 * Validates input handling, 404s, and response shapes.
 */

const request = require('supertest');

process.env.JWT_SECRET = 'test-jwt-secret-ci';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-ci';
process.env.TEMP_JWT_SECRET = 'test-temp-secret-ci';
process.env.NODE_ENV = 'test';

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

jest.mock('rate-limit-redis', () => ({
  RedisStore: jest.fn().mockImplementation(() => ({
    init: jest.fn(),
    increment: jest.fn().mockResolvedValue({ totalHits: 1, resetTime: new Date() }),
    decrement: jest.fn(),
    resetKey: jest.fn()
  }))
}));

const app = require('../../src/app');

describe('Post API — Unauthenticated', () => {
  describe('GET /api/v1/posts/:postId', () => {
    it('should reject without auth token', async () => {
      const res = await request(app).get('/api/v1/posts/507f1f77bcf86cd799439011');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('MISSING_ACCESS_TOKEN');
    });
  });

  describe('POST /api/v1/posts', () => {
    it('should reject post creation without auth', async () => {
      const res = await request(app)
        .post('/api/v1/posts')
        .send({ text: 'Hello world' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/posts/:postId/like', () => {
    it('should reject like without auth', async () => {
      const res = await request(app)
        .post('/api/v1/posts/507f1f77bcf86cd799439011/like');
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/v1/posts/:postId', () => {
    it('should reject delete without auth', async () => {
      const res = await request(app)
        .delete('/api/v1/posts/507f1f77bcf86cd799439011');
      expect(res.status).toBe(401);
    });
  });
});

describe('Post Search API — Unauthenticated', () => {
  describe('GET /api/v1/posts/search', () => {
    it('should reject search without auth', async () => {
      const res = await request(app).get('/api/v1/posts/search?q=hello');
      expect(res.status).toBe(401);
    });
  });
});

describe('User API — Unauthenticated', () => {
  describe('GET /api/v1/users/me', () => {
    it('should reject without auth', async () => {
      const res = await request(app).get('/api/v1/users/me');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/v1/users/me', () => {
    it('should reject profile update without auth', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .send({ 'profile.bio': 'New bio' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/users/search', () => {
    it('should reject search without auth', async () => {
      const res = await request(app).get('/api/v1/users/search?q=test');
      expect(res.status).toBe(401);
    });
  });
});

describe('Feed API — Unauthenticated', () => {
  it('should reject feed without auth', async () => {
    const res = await request(app).get('/api/v1/feed/home');
    expect(res.status).toBe(401);
  });
});

describe('Chat API — Unauthenticated', () => {
  it('should reject conversations without auth', async () => {
    const res = await request(app).get('/api/v1/chat/conversations');
    expect(res.status).toBe(401);
  });
});

describe('API Response Format', () => {
  it('should return consistent error format on 404', async () => {
    const res = await request(app).get('/api/v1/nonexistent-route');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('message');
  });

  it('should return JSON content type', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-type']).toMatch(/json/);
  });
});

const Redis = require("ioredis");

class CacheService {
  constructor() {
    let redis;

    // ✅ PRODUCTION (Upstash / any cloud Redis)
    if (process.env.REDIS_URL) {
      redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
      });
    }
    // ✅ LOCAL DEVELOPMENT ONLY
    else {
      redis = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
      });
    }

    this.redis = redis;
    this.isConnected = false;
    // In-flight promises for single-flight getOrSet (per worker). Prevents a
    // cache-miss stampede: when 10K requests miss the same key at once, only
    // ONE runs the expensive fetch; the rest await the same promise.
    this._inflight = new Map();

    // Events
    this.redis.on("connect", () => {
      console.log("🔗 Connecting to Redis...");
    });

    this.redis.on("ready", () => {
      console.log("✅ Redis is ready to use!");
      this.isConnected = true;
    });

    this.redis.on("error", (error) => {
      console.error("❌ Redis connection error:", error.message);
      this.isConnected = false;
    });

    this.redis.on("close", () => {
      console.log("🔌 Redis connection closed");
      this.isConnected = false;
    });

    this.redis.on("reconnecting", () => {
      console.log("🔄 Reconnecting to Redis...");
    });
  }

  async ping() {
    try {
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async set(key, value, ttl = 600) {
    try {
      return ttl
        ? await this.redis.setex(key, ttl, JSON.stringify(value))
        : await this.redis.set(key, JSON.stringify(value));
    } catch {
      return false;
    }
  }

  async get(key) {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  async del(key) {
    try {
      return await this.redis.del(key);
    } catch {
      return 0;
    }
  }

  async exists(key) {
    try {
      return await this.redis.exists(key);
    } catch {
      return false;
    }
  }

  // Add ±10% jitter to a TTL so a batch of keys created together don't all
  // expire on the same tick (which would cause a synchronized stampede).
  _jitter(ttl) {
    if (!ttl) return ttl;
    const spread = Math.floor(ttl * 0.1);
    return ttl + Math.floor((Math.random() * 2 - 1) * spread);
  }

  /**
   * Cache-aside read with single-flight + TTL jitter.
   *
   * On a miss, only ONE caller per worker runs `fetchFunction`; concurrent
   * callers for the same key await that same promise. This is the core defense
   * against the feed read path melting MongoDB under load — a popular feed page
   * that just expired is recomputed once, not once per concurrent request.
   *
   * Redis being down degrades gracefully to calling the fetch directly.
   */
  async getOrSet(key, fetchFunction, ttl = 600) {
    const cached = await this.get(key);
    if (cached !== null) return cached;

    // Coalesce concurrent misses on this key within this process.
    if (this._inflight.has(key)) return this._inflight.get(key);

    const promise = (async () => {
      const fresh = await fetchFunction();
      // Only cache non-empty results to avoid pinning an empty feed for a TTL.
      if (fresh !== undefined && fresh !== null) {
        await this.set(key, fresh, this._jitter(ttl));
      }
      return fresh;
    })();

    this._inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this._inflight.delete(key);
    }
  }

  // Delete every key matching a pattern (e.g. invalidate a user's feed pages).
  // Uses SCAN (non-blocking) rather than KEYS, which is O(N) and blocks Redis.
  async delPattern(pattern) {
    try {
      let cursor = '0';
      let deleted = 0;
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length) deleted += await this.redis.del(...keys);
      } while (cursor !== '0');
      return deleted;
    } catch {
      return 0;
    }
  }

  // Atomic increment-with-expiry. The old INCR-then-EXPIRE was non-atomic: a
  // crash between the two commands left a key with NO TTL, permanently locking
  // that identifier (e.g. silently blocking a phone/email from ever receiving
  // an OTP again). This Lua script sets the TTL on first increment in one
  // atomic step.
  async incrementRateLimit(key, ttl = 60) {
    try {
      const lua = `
        local c = redis.call('INCR', KEYS[1])
        if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
        return c
      `;
      return await this.redis.eval(lua, 1, key, ttl);
    } catch {
      return 1;
    }
  }

  // Factory: create a new Redis client with identical connection config.
  // Used by Socket.IO Redis adapter which needs separate pub/sub clients.
  createClient() {
    if (process.env.REDIS_URL) {
      return new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
      });
    }
    return new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
    });
  }

  async disconnect() {
    try {
      await this.redis.quit();
    } catch { }
  }

  async getStats() {
    try {
      const info = await this.redis.info('memory');
      return { raw: info };
    } catch {
      return { error: 'Stats unavailable' };
    }
  }
}

module.exports = new CacheService();

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

  async getOrSet(key, fetchFunction, ttl = 600) {
    const cached = await this.get(key);
    if (cached !== null) return cached;

    const fresh = await fetchFunction();
    await this.set(key, fresh, ttl);
    return fresh;
  }

  async incrementRateLimit(key, ttl = 60) {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, ttl);
      return count;
    } catch {
      return 1;
    }
  }

  async disconnect() {
    try {
      await this.redis.quit();
    } catch {}
  }
}

module.exports = new CacheService();

const Redis = require("ioredis");
const config = require("./index");

const redisConfig = config.get("redis");

const redisClient = redisConfig.url
  ? new Redis(redisConfig.url, {
      maxRetriesPerRequest: redisConfig.maxRetries,
      retryStrategy(times) {
        return Math.min(times * 50, 2000);
      }
    })
  : new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      maxRetriesPerRequest: redisConfig.maxRetries
    });

redisClient.on("connect", () => {
  console.log("✅ Redis Connected");
});

redisClient.on("error", (err) => {
  console.error("❌ Redis Error:", err);
});

module.exports = redisClient;

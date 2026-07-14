/**
 * Per-socket event rate limiting.
 *
 * Socket.IO events bypass the Express/Redis HTTP rate limiter entirely, so a
 * handful of abusive sockets could otherwise flood `send_message`, `typing`,
 * reactions, etc. — driving event-loop and Mongo load for the whole worker.
 *
 * We use a simple in-memory token bucket PER SOCKET. In-memory is correct here
 * (unlike HTTP limits) because a socket lives entirely on one worker, so there
 * is nothing to share across processes — and it costs one small object per
 * connection, which is fine even at tens of thousands of sockets per process.
 * The bucket is discarded when the socket disconnects.
 */

// Tokens refill continuously at `ratePerSec`, capped at `burst`.
class TokenBucket {
  constructor(ratePerSec, burst) {
    this.ratePerSec = ratePerSec;
    this.burst = burst;
    this.tokens = burst;
    this.last = Date.now();
  }

  tryRemove(now) {
    const elapsed = (now - this.last) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSec);
      this.last = now;
    }
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

// Default ceilings per event class (generous for legit clients, low enough to
// stop a flood). Tunable without touching handler code.
const LIMITS = {
  message: { ratePerSec: 5, burst: 10 },   // send_message / delete
  reaction: { ratePerSec: 8, burst: 16 },  // add/remove reaction, mark seen
  typing: { ratePerSec: 4, burst: 8 },     // typing indicators
  presence: { ratePerSec: 1, burst: 3 },   // user_online etc.
  default: { ratePerSec: 10, burst: 20 },
};

/**
 * Returns a guard bound to a single socket. Call `guard(category)` at the top
 * of each handler; it returns false (and the handler should bail) when the
 * socket has exceeded its budget for that category.
 */
function createSocketLimiter(socket) {
  const buckets = new Map();
  let warned = 0;

  const guard = (category = 'default') => {
    const cfg = LIMITS[category] || LIMITS.default;
    let bucket = buckets.get(category);
    if (!bucket) {
      bucket = new TokenBucket(cfg.ratePerSec, cfg.burst);
      buckets.set(category, bucket);
    }
    const allowed = bucket.tryRemove(Date.now());
    if (!allowed) {
      // Only emit a throttle notice occasionally to avoid amplifying the flood.
      if (warned % 20 === 0) {
        socket.emit('rate_limited', { category });
      }
      warned++;
    }
    return allowed;
  };

  return guard;
}

module.exports = { createSocketLimiter, LIMITS };

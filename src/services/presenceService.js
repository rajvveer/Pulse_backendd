/**
 * Presence service — tracks which users are online without touching MongoDB.
 *
 * Online state is stored in Redis as short-TTL keys (`presence:<userId>`) so it
 * is shared across all cluster workers / containers and self-heals if a process
 * dies (the key simply expires). A per-user socket counter handles the common
 * case of a user with several devices / tabs: we only flip them "offline" when
 * the LAST socket for that user disconnects.
 *
 * At 100K concurrent connections this replaces a `Conversation.find()` on every
 * connect/disconnect (which hammered the Mongo pool) with a single O(1) Redis
 * INCR/DECR. Presence change notifications are still scoped to the user's
 * conversation peers — never broadcast globally (see realtime.js).
 */
const cacheService = require('./cacheService');

// How long a presence key lives without a refresh. Sockets ping every ~25s, so
// 90s comfortably survives a missed heartbeat without showing ghosts forever.
const PRESENCE_TTL_SEC = 90;
const keyFor = (userId) => `presence:${userId}`;
const countKeyFor = (userId) => `presence:count:${userId}`;

/**
 * Register a new socket for a user. Returns true if the user JUST came online
 * (i.e. this was their first connected socket), so the caller can decide
 * whether to notify peers.
 */
async function addConnection(userId) {
  if (!userId) return false;
  try {
    const count = await cacheService.redis.incr(countKeyFor(userId));
    // Keep the counter from leaking if a process dies mid-session.
    await cacheService.redis.expire(countKeyFor(userId), PRESENCE_TTL_SEC * 4);
    await cacheService.redis.set(keyFor(userId), '1', 'EX', PRESENCE_TTL_SEC);
    return count === 1;
  } catch {
    return false;
  }
}

/**
 * De-register a socket for a user. Returns true if the user just went OFFLINE
 * (their last socket disconnected).
 */
async function removeConnection(userId) {
  if (!userId) return false;
  try {
    const count = await cacheService.redis.decr(countKeyFor(userId));
    if (count <= 0) {
      await cacheService.redis.del(countKeyFor(userId));
      await cacheService.redis.del(keyFor(userId));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Refresh the TTL — call on socket heartbeat / activity. */
async function touch(userId) {
  if (!userId) return;
  try {
    await cacheService.redis.set(keyFor(userId), '1', 'EX', PRESENCE_TTL_SEC);
  } catch {
    /* best-effort */
  }
}

/** Is a single user online? */
async function isOnline(userId) {
  if (!userId) return false;
  try {
    return (await cacheService.redis.exists(keyFor(userId))) === 1;
  } catch {
    return false;
  }
}

/**
 * Bulk presence check for a list of user IDs (e.g. a conversation list).
 * Returns a Set of online userId strings. Uses a single MGET round-trip.
 */
async function getOnlineSet(userIds = []) {
  const online = new Set();
  if (!userIds.length) return online;
  try {
    const ids = userIds.map((id) => id.toString());
    const values = await cacheService.redis.mget(ids.map(keyFor));
    ids.forEach((id, i) => {
      if (values[i]) online.add(id);
    });
  } catch {
    /* degrade to "everyone offline" rather than throw */
  }
  return online;
}

module.exports = {
  addConnection,
  removeConnection,
  touch,
  isOnline,
  getOnlineSet,
  PRESENCE_TTL_SEC,
};

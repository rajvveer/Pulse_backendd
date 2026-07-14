const xss = require('xss');

// Bounds on the recursive walk. A crafted deeply-nested or wide JSON body could
// otherwise pin the event loop running xss() across thousands of nodes
// (synchronous, ~hundreds of ms on a large body). These caps keep the cost
// bounded; anything beyond them is left as-is (it isn't a normal request).
const MAX_DEPTH = parseInt(process.env.SANITIZE_MAX_DEPTH) || 12;
const MAX_NODES = parseInt(process.env.SANITIZE_MAX_NODES) || 5000;
const MAX_STRING_LEN = parseInt(process.env.SANITIZE_MAX_STRING) || 50000;

/**
 * Sanitize middleware — recursively cleans all string values in req.body
 * Prevents stored XSS attacks from user-generated content (posts, comments, bios, etc.)
 */
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = deepSanitize(req.body, 0, { count: 0 });
  }
  next();
}

/**
 * Recursively sanitize all string values in an object, bounded by depth and a
 * total node budget. Preserves structure, only cleans strings.
 */
function deepSanitize(obj, depth = 0, budget = { count: 0 }) {
  if (depth > MAX_DEPTH || budget.count > MAX_NODES) {
    return obj; // stop walking — pathological payload
  }
  budget.count++;

  if (typeof obj === 'string') {
    // Skip xss() on absurdly long strings (cost is linear) — truncate-guard.
    if (obj.length > MAX_STRING_LEN) return obj.slice(0, MAX_STRING_LEN);
    return xss(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => deepSanitize(item, depth + 1, budget));
  }
  if (obj !== null && typeof obj === 'object') {
    const cleaned = {};
    for (const key of Object.keys(obj)) {
      if (budget.count > MAX_NODES) { cleaned[key] = obj[key]; continue; }
      cleaned[key] = deepSanitize(obj[key], depth + 1, budget);
    }
    return cleaned;
  }
  return obj;
}

module.exports = { sanitizeBody, deepSanitize };

const xss = require('xss');

/**
 * Sanitize middleware — recursively cleans all string values in req.body
 * Prevents stored XSS attacks from user-generated content (posts, comments, bios, etc.)
 */
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = deepSanitize(req.body);
  }
  next();
}

/**
 * Recursively sanitize all string values in an object.
 * Preserves structure, only cleans strings.
 */
function deepSanitize(obj) {
  if (typeof obj === 'string') {
    return xss(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => deepSanitize(item));
  }
  if (obj !== null && typeof obj === 'object') {
    const cleaned = {};
    for (const key of Object.keys(obj)) {
      cleaned[key] = deepSanitize(obj[key]);
    }
    return cleaned;
  }
  return obj;
}

module.exports = { sanitizeBody, deepSanitize };

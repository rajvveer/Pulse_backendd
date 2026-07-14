/**
 * Escape regex metacharacters in user input before using it in a MongoDB
 * $regex / RegExp. Prevents ReDoS (e.g. "(a+)+$") and unintended matches.
 */
module.exports = function escapeRegex(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

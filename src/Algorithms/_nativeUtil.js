'use strict';
/**
 * Helpers for the JS → C++ boundary.
 *
 * The native kernels expect timestamps as epoch milliseconds (numbers), but
 * Mongo docs / lean objects carry `createdAt` as a Date (which JSON.stringify
 * turns into an ISO string the C++ side reads as 0). normalize those fields to
 * numbers before stringifying, recursively through given nested array fields.
 */

const toMs = (v) => {
  if (v == null) return v;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? v : t;
};

/**
 * Return a shallow-cloned array of items where each `dateFields` entry is
 * converted to epoch ms, recursing into each `nestedArrayFields` array.
 * Does not mutate the inputs.
 */
function msFields(items, dateFields = ['createdAt'], nestedArrayFields = []) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const copy = { ...item };
    for (const f of dateFields) {
      if (copy[f] !== undefined) copy[f] = toMs(copy[f]);
    }
    for (const nf of nestedArrayFields) {
      if (Array.isArray(copy[nf])) copy[nf] = msFields(copy[nf], dateFields, nestedArrayFields);
    }
    return copy;
  });
}

module.exports = { toMs, msFields };

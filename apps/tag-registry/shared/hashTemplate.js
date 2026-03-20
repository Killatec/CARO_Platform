import crypto from 'crypto';

/**
 * Generate a 6-character hex SHA-1 hash of a template.
 * Uses canonical JSON serialization (keys sorted, no whitespace).
 *
 * @param {Object} template - The template object
 * @returns {string} 6-character hex hash
 */
export function hashTemplate(template) {
  const canonical = canonicalJSON(template);
  const hash = crypto.createHash('sha1').update(canonical).digest('hex');
  return hash.substring(0, 6);
}

/**
 * Canonicalize a value for hashing.
 * Recursively sorts all object keys, no whitespace.
 *
 * @param {*} value - Value to canonicalize
 * @returns {string} Canonical JSON string
 */
function canonicalJSON(value) {
  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  if (typeof value === 'boolean') {
    return value.toString();
  }

  if (typeof value === 'number') {
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map(item => canonicalJSON(item));
    return '[' + items.join(',') + ']';
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const pairs = keys.map(key => {
      return JSON.stringify(key) + ':' + canonicalJSON(value[key]);
    });
    return '{' + pairs.join(',') + '}';
  }

  return JSON.stringify(value);
}

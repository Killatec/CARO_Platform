import crypto from 'crypto';

/**
 * Generate a 6-character hex SHA-1 hash of a template.
 * Uses canonical JSON serialization (keys sorted, no whitespace).
 */
export function hashTemplate(template: object): string {
  const canonical = canonicalJSON(template);
  const hash = crypto.createHash('sha1').update(canonical).digest('hex');
  return hash.substring(0, 6);
}

/**
 * Canonicalize a value for hashing.
 * Recursively sorts all object keys, no whitespace.
 */
function canonicalJSON(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'boolean') return value.toString();
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return '[' + value.map(item => canonicalJSON(item)).join(',') + ']';
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const pairs = keys.map(key =>
      JSON.stringify(key) + ':' + canonicalJSON((value as Record<string, unknown>)[key])
    );
    return '{' + pairs.join(',') + '}';
  }

  return JSON.stringify(value);
}

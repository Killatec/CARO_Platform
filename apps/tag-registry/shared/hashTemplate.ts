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
 * Full-length hex SHA-256 of a Tag Defs `tags` tree, using the same canonical
 * JSON as hashTemplate. SHA-256 rather than truncated SHA-1 because this hash
 * leaves the app — a firmware build compares it (RF_Control CARO_MIGRATION.md
 * D27/D32) — so it must not collide by accident.
 *
 * Input is the nested `tags` tree; canonicalJSON sorts keys at every level
 * (code-unit order), so insertion order does not affect the hash.
 */
export function hashTagDefs(tags: object): string {
  return crypto.createHash('sha256').update(canonicalJSON(tags)).digest('hex');
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

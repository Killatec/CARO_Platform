/**
 * Deep equality check using JSON serialization.
 * Sufficient for plain template data objects — no functions,
 * no undefined values, no circular refs.
 */
export function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function deepNotEqual(a, b) {
  return !deepEqual(a, b);
}

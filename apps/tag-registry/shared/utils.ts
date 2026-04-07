/**
 * Deep equality check using JSON serialization.
 * Sufficient for plain template data objects — no functions,
 * no undefined values, no circular refs.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function deepNotEqual(a: unknown, b: unknown): boolean {
  return !deepEqual(a, b);
}

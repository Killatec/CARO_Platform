import { expect } from 'vitest';

/**
 * Assert that vitest spies were invoked in the given order.
 *
 * Each spy must have been called at least once. Uses the first invocationCallOrder
 * value per spy (i.e., the order of each spy's FIRST call) — adequate for the
 * common case of "A fired before B." Pass spies in the order you expect them to
 * have been called.
 *
 * Example:
 *   expectCallOrder(commitAndDrainSpy, refetchHistorySpy);
 *
 * Fails with a descriptive message if any spy was never called, or if the order
 * is inverted.
 */
export function expectCallOrder(
  ...spies: Array<{ mock: { invocationCallOrder: number[]; calls: unknown[][] } }>
): void {
  for (let i = 0; i < spies.length; i++) {
    const s = spies[i]!;
    if (s.mock.calls.length === 0) {
      throw new Error(`expectCallOrder: spy #${i} was never invoked`);
    }
  }
  const orders = spies.map(s => s.mock.invocationCallOrder[0]!);
  for (let i = 1; i < orders.length; i++) {
    expect(orders[i]).toBeGreaterThan(orders[i - 1]!);
  }
}

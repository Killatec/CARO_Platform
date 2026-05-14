/**
 * If `from < 1n`, shift the range rightward so from = 1n while preserving span.
 * Server requires startTime > 0; this clamp silently corrects any (from, to) pair
 * landing below epoch 0 due to wheel-zoom or pan arithmetic near the data origin.
 */
export function clampLowerBound(from: bigint, to: bigint): { from: bigint; to: bigint } {
  if (from >= 1n) return { from, to };
  const shift = 1n - from;
  return { from: 1n, to: to + shift };
}

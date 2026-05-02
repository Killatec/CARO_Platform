import type uPlot from 'uplot';

// ── Override map helpers (pure, exported for testing) ─────────────────────────

/**
 * Removes entries from the override map for any tagId not in currentTagIds.
 * Copies the key iterator before mutating to avoid iteration-during-deletion issues.
 */
export function pruneRemovedTagOverrides<T>(
  overrides: Map<number, T>,
  currentTagIds: readonly number[],
): void {
  const currentSet = new Set(currentTagIds);
  for (const id of [...overrides.keys()]) {
    if (!currentSet.has(id)) overrides.delete(id);
  }
}

// ── Y-axis interaction helpers (pure, exported for testing) ───────────────────

/** True if (clientX, clientY) is in the Y-axis margin (left of u.over, full height). */
export function isInYAxisHitZone(u: uPlot, clientX: number, clientY: number): boolean {
  const r = u.over.getBoundingClientRect();
  return clientX < r.left && clientX >= r.left - 100 && clientY >= r.top && clientY <= r.bottom;
}

/** Pan a uPlot Y scale by dyPx pixels of vertical drag (positive = drag down). */
export function panYScale(u: uPlot, scaleKey: string, dyPx: number, overHeightPx: number): void {
  const yScale = u.scales[scaleKey];
  if (!yScale) return;
  const yMin = yScale.min ?? 0;
  const yMax = yScale.max ?? 1;
  const ySpan = yMax - yMin;
  if (overHeightPx === 0 || ySpan === 0) return;
  const dataDy = (dyPx / overHeightPx) * ySpan;
  u.setScale(scaleKey, { min: yMin + dataDy, max: yMax + dataDy });
}

/**
 * Zoom a uPlot Y scale around a cursor pixel position (cursorYPx from top of u.over).
 * deltaY > 0 = wheel down = zoom out by factor; < 0 = zoom in by 1/factor.
 */
export function zoomYScale(
  u: uPlot,
  scaleKey: string,
  deltaY: number,
  cursorYPx: number,
  overHeightPx: number,
  factor = 1.2,
): void {
  const yScale = u.scales[scaleKey];
  if (!yScale) return;
  const yMin = yScale.min ?? 0;
  const yMax = yScale.max ?? 1;
  const ySpan = yMax - yMin;
  if (overHeightPx === 0 || ySpan === 0) return;
  // cursorFrac: 0 at bottom (min), 1 at top (max) — inverted from pixel Y.
  const cursorFrac = Math.max(0, Math.min(1, 1 - cursorYPx / overHeightPx));
  const cursorY = yMin + cursorFrac * ySpan;
  const f = deltaY > 0 ? factor : 1 / factor;
  const newYSpan = ySpan * f;
  u.setScale(scaleKey, {
    min: cursorY - cursorFrac * newYSpan,
    max: cursorY + (1 - cursorFrac) * newYSpan,
  });
}

// ── X-axis interaction helpers (pure, exported for testing) ──────────────────

/**
 * Returns the range to pass to ensureCovered if the visible window has panned
 * within halfTileMs of the cached extent's edge, or null if comfortable inside.
 * halfTileMs = visSpanMs / 4 (since tileSpan = visSpan / visibleTilesPerWindow = visSpan/2).
 */
export function panThresholdCheck(
  visMinMs: bigint,
  visMaxMs: bigint,
  cachedStartMs: bigint,
  cachedEndMs: bigint,
): { startMs: bigint; endMs: bigint } | null {
  const visSpanMs = visMaxMs - visMinMs;
  const halfTileMs = visSpanMs / 4n;
  const tileSpanMs = visSpanMs / 2n;
  if (visMinMs < cachedStartMs + halfTileMs) {
    return { startMs: cachedStartMs - tileSpanMs, endMs: cachedStartMs };
  }
  if (visMaxMs > cachedEndMs - halfTileMs) {
    return { startMs: cachedEndMs, endMs: cachedEndMs + tileSpanMs };
  }
  return null;
}

/** True if (clientX, clientY) is in the X-axis margin (below u.over, full plot width). */
export function isInXAxisHitZone(u: uPlot, clientX: number, clientY: number): boolean {
  const r = u.over.getBoundingClientRect();
  return (
    clientY > r.bottom &&
    clientY <= r.bottom + 100 &&
    clientX >= r.left &&
    clientX <= r.right
  );
}

/** Pan the uPlot X scale by dxPx pixels of horizontal drag (positive = drag right; window shifts left). */
export function panXScale(u: uPlot, dxPx: number, overWidthPx: number): void {
  const xScale = u.scales['x'];
  if (!xScale || overWidthPx === 0) return;
  const minX = xScale.min ?? 0;
  const maxX = xScale.max ?? 1;
  const span = maxX - minX;
  if (span === 0) return;
  const dataDx = (dxPx / overWidthPx) * span;
  u.setScale('x', { min: minX - dataDx, max: maxX - dataDx });
}

/** Zoom the uPlot X scale around a cursor pixel position (cursorXPx from u.over.left). */
export function zoomXScale(u: uPlot, deltaY: number, cursorXPx: number, overWidthPx: number, factor = 1.2): void {
  const xScale = u.scales['x'];
  if (!xScale || overWidthPx === 0) return;
  const xMin = xScale.min ?? 0;
  const xMax = xScale.max ?? 1;
  const span = xMax - xMin;
  if (span === 0) return;
  const f = deltaY > 0 ? factor : 1 / factor;
  const newSpan = span * f;
  const cursorFrac = Math.max(0, Math.min(1, cursorXPx / overWidthPx));
  const cursorX = xMin + cursorFrac * span;
  u.setScale('x', { min: cursorX - cursorFrac * newSpan, max: cursorX + (1 - cursorFrac) * newSpan });
}

// Shared post-setScale threshold check — used by both X-pan and X-wheel handlers.
// Fires ensureCovered when the visible X range crosses 50% into the cached extent's edge.
export function checkAndExtendXCoverage(u: uPlot, ensureCovered?: (startMs: bigint, endMs: bigint) => void): void {
  const xs = u.data[0];
  const xScale = u.scales['x'];
  if (!xs || xs.length === 0 || !xScale || !ensureCovered) return;
  const cachedStartMs = BigInt(Math.round((xs[0] as number) * 1000));
  const cachedEndMs = BigInt(Math.round((xs[xs.length - 1] as number) * 1000));
  const visMinMs = BigInt(Math.round((xScale.min ?? 0) * 1000));
  const visMaxMs = BigInt(Math.round((xScale.max ?? 1) * 1000));
  const need = panThresholdCheck(visMinMs, visMaxMs, cachedStartMs, cachedEndMs);
  if (need) ensureCovered(need.startMs, need.endMs);
}

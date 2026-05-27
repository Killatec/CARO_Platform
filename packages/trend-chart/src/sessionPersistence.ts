/**
 * Session persistence for the trend viewer.
 * Pure module — no React. All localStorage access is wrapped in try/catch
 * so Safari private-browsing, quota limits, and parse errors are silent.
 */

const SESSION_KEY_PREFIX = 'caro.trend-viewer.session.';

export interface TrendViewerSessionV1 {
  version: 1;
  tagIds: number[];
  selectedTagId: number | null;
  /** BigInt serialised as decimal string. */
  sizeMs: string;
  mode: 'fixed' | 'live-trailing' | 'live-fixed';
  /** BigInt as decimal string; null for live-trailing. */
  toMs: string | null;
  yScaleOverrides: Record<number, { min: number; max: number }>;
}

// ── Serialisation ─────────────────────────────────────────────────────────────

export function serialiseSession(session: TrendViewerSessionV1): string {
  // yScaleOverrides keys are numbers; JSON.stringify converts them to strings.
  // The round-trip is handled in parseSession by Number(key).
  return JSON.stringify(session);
}

const DECIMAL_RE = /^\d+$/;
const VALID_MODES = new Set(['fixed', 'live-trailing', 'live-fixed']);

export function parseSession(raw: string): TrendViewerSessionV1 | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;

    // version
    if (obj['version'] !== 1) return null;

    // tagIds
    if (!Array.isArray(obj['tagIds'])) return null;
    const tagIds = obj['tagIds'] as unknown[];
    if (!tagIds.every(id => typeof id === 'number' && Number.isInteger(id) && id >= 0)) return null;

    // selectedTagId
    const rawSel = obj['selectedTagId'];
    if (rawSel !== null && !(typeof rawSel === 'number' && Number.isInteger(rawSel) && rawSel >= 0)) return null;

    // sizeMs
    if (typeof obj['sizeMs'] !== 'string' || !DECIMAL_RE.test(obj['sizeMs'])) return null;

    // mode
    if (typeof obj['mode'] !== 'string' || !VALID_MODES.has(obj['mode'])) return null;
    const mode = obj['mode'] as 'fixed' | 'live-trailing' | 'live-fixed';

    // toMs
    const rawToMs = obj['toMs'];
    if (rawToMs !== null) {
      if (typeof rawToMs !== 'string' || !DECIMAL_RE.test(rawToMs)) return null;
    }

    // toMs required for fixed / live-fixed, must be null for live-trailing
    if ((mode === 'fixed' || mode === 'live-fixed') && rawToMs === null) return null;
    if (mode === 'live-trailing' && rawToMs !== null) return null;

    // yScaleOverrides
    const rawOverrides = obj['yScaleOverrides'];
    if (rawOverrides === null || typeof rawOverrides !== 'object' || Array.isArray(rawOverrides)) return null;
    const overridesRaw = rawOverrides as Record<string, unknown>;

    const yScaleOverrides: Record<number, { min: number; max: number }> = {};
    for (const [key, val] of Object.entries(overridesRaw)) {
      if (!DECIMAL_RE.test(key)) return null;
      if (val === null || typeof val !== 'object' || Array.isArray(val)) return null;
      const entry = val as Record<string, unknown>;
      if (typeof entry['min'] !== 'number' || typeof entry['max'] !== 'number') return null;
      if (!Number.isFinite(entry['min']) || !Number.isFinite(entry['max'])) return null;
      yScaleOverrides[Number(key)] = { min: entry['min'] as number, max: entry['max'] as number };
    }

    return {
      version: 1,
      tagIds: tagIds as number[],
      selectedTagId: rawSel as number | null,
      sizeMs: obj['sizeMs'] as string,
      mode,
      toMs: rawToMs as string | null,
      yScaleOverrides,
    };
  } catch {
    return null;
  }
}

// ── Storage helpers ───────────────────────────────────────────────────────────

export function loadSession(persistKey: string): TrendViewerSessionV1 | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY_PREFIX + persistKey);
    if (!raw) return null;
    const session = parseSession(raw);
    if (session === null) {
      console.warn('[TrendViewer] Session discarded: invalid format or version mismatch');
    }
    return session;
  } catch (e) {
    console.warn('[TrendViewer] Failed to load session from localStorage:', e);
    return null;
  }
}

export function saveSession(persistKey: string, session: TrendViewerSessionV1): void {
  try {
    localStorage.setItem(SESSION_KEY_PREFIX + persistKey, serialiseSession(session));
  } catch (e) {
    console.warn('[TrendViewer] Failed to save session to localStorage:', e);
  }
}

export function clearSession(persistKey: string): void {
  try {
    localStorage.removeItem(SESSION_KEY_PREFIX + persistKey);
  } catch (e) {
    console.warn('[TrendViewer] Failed to clear session from localStorage:', e);
  }
}

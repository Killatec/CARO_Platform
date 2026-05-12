import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';

// Keep in sync with TREND_VIEWER_DEFAULTS.bucketCount in packages/trend-chart/src/level.ts
const DEFAULT_BUCKET_COUNT = 500;
// From TREND_VIEWER_DEFAULTS.visibleTilesPerWindow in packages/trend-chart/src/level.ts.
// Inlined here because importing transitively pulls in uPlot and breaks the test shim's matchMedia mock.
const DEFAULT_VISIBLE_TILES = 2;

// ── Types ──────────────────────────────────────────────────────────────────────

interface TrendExtent {
  oldestTs: number | null;
  newestTs: number | null;
}

interface TrendableTag {
  tag_id: number;
  tag_path: string;
}

interface CellState {
  state: 'idle' | 'running' | 'done' | 'error' | 'insufficientHistory';
  ms?: number;
  n?: number;
  slowest?: number;
  fastest?: number;
  errorCode?: string;
}

interface RowResult {
  live: CellState;
  historical: CellState;
}

interface Inputs {
  pointsPerTile: number;
  nTiles: number;
  tagCount: number;
}

// ── Row definitions (§H) ───────────────────────────────────────────────────────

export const ROWS = [
  { label: 'Raw',              bucketS: 0.5 },
  { label: '1s CAG, Div=1',    bucketS: 1 },
  { label: '1s CAG, Div=8',    bucketS: 8 },
  { label: '10s CAG, Div=1',   bucketS: 10 },
  { label: '10s CAG, Div=8',   bucketS: 80 },
  { label: '1min CAG, Div=1',  bucketS: 60 },
  { label: '1min CAG, Div=8',  bucketS: 480 },
  { label: '10min CAG, Div=1', bucketS: 600 },
  { label: '10min CAG, Div=8', bucketS: 4800 },
] as const;

// ── Pure helper functions (exported for unit tests) ────────────────────────────

export function formatDuration(seconds: number): string {
  if (seconds < 3600)  return `${seconds} s`;
  if (seconds < 86400) return `≈${(seconds / 3600).toFixed(1)} h`;
  return `≈${(seconds / 86400).toFixed(1)} d`;
}

export interface TileWindow {
  startTime: bigint;
  endTime: bigint;
}

export function computeLiveTileWindows(opts: {
  nowMs: number;
  bucketS: number;
  pointsPerTile: number;
  nTiles: number;
}): TileWindow[] {
  const { nowMs, bucketS, pointsPerTile, nTiles } = opts;
  const tileSpanMs = bucketS * pointsPerTile * 1000;
  const lastTileIndex = Math.floor(nowMs / tileSpanMs);
  const windows: TileWindow[] = [];
  for (let i = lastTileIndex - nTiles + 1; i <= lastTileIndex; i++) {
    windows.push({
      startTime: BigInt(Math.round(i * tileSpanMs)),
      endTime:   BigInt(Math.round((i + 1) * tileSpanMs)),
    });
  }
  return windows;
}

export function computeHistoricalTileWindows(opts: {
  bucketS: number;
  pointsPerTile: number;
  nTiles: number;
  oldestMs: bigint;
  newestMs: bigint;
}): TileWindow[] | { insufficientHistory: true } {
  const { bucketS, pointsPerTile, nTiles, oldestMs, newestMs } = opts;
  // tileSpanMs: span of one tile in ms; windowMs: total span of nTiles tiles.
  const tileSpanMs = bucketS * pointsPerTile * 1000;
  const windowMs   = nTiles * tileSpanMs;

  const oldestN     = Number(oldestMs);
  const newestN     = Number(newestMs);
  const earliestEnd = oldestN + windowMs;
  // 1-hour exclusion keeps historical column away from the live-edge watermark region.
  const latestEnd   = newestN - 3_600_000;

  if (latestEnd <= earliestEnd) return { insufficientHistory: true };

  const rangeEndMs   = earliestEnd + Math.random() * (latestEnd - earliestEnd);
  const rangeStartMs = rangeEndMs - windowMs;
  const firstTileIndex = Math.floor(rangeStartMs / tileSpanMs);

  const windows: TileWindow[] = [];
  for (let i = firstTileIndex; i < firstTileIndex + nTiles; i++) {
    windows.push({
      startTime: BigInt(Math.round(i * tileSpanMs)),
      endTime:   BigInt(Math.round((i + 1) * tileSpanMs)),
    });
  }
  return windows;
}

// ── Fetch helpers ──────────────────────────────────────────────────────────────

async function timedFetch(
  startTime: bigint,
  endTime: bigint,
  tagIds: number[],
  pointsPerTile: number,
): Promise<{ ms: number }> {
  const url =
    `/api/v1/trends/tile` +
    `?tag_ids=${tagIds.join(',')}` +
    `&start_time=${startTime}` +
    `&end_time=${endTime}` +
    `&bucket_count=${pointsPerTile}`;

  const t0  = performance.now();
  const res = await fetch(url);
  const body = await res.json() as { ok: boolean; error?: { code: string } };
  const ms  = performance.now() - t0;

  if (!res.ok || !body.ok) {
    throw Object.assign(new Error('tile fetch error'), {
      code: body.error?.code ?? `HTTP_${res.status}`,
    });
  }
  return { ms };
}

interface MeasureSuccess {
  totalMs: number;
  n: number;
  slowestMs: number;
  fastestMs: number;
}

async function measureCell(
  tileWindows: TileWindow[],
  tagIds: number[],
  pointsPerTile: number,
): Promise<MeasureSuccess | { error: string }> {
  const tagGroups: number[][] = [];
  for (let i = 0; i < tagIds.length; i += 8) tagGroups.push(tagIds.slice(i, i + 8));

  const perReqMs: number[] = [];
  const t0 = performance.now();

  try {
    await Promise.all(
      tileWindows.flatMap(win =>
        tagGroups.map(group =>
          timedFetch(win.startTime, win.endTime, group, pointsPerTile)
            .then(({ ms }) => { perReqMs.push(ms); }),
        ),
      ),
    );
  } catch (e: unknown) {
    return { error: (e as { code?: string }).code ?? 'UNKNOWN' };
  }

  return {
    totalMs:  performance.now() - t0,
    n:        perReqMs.length,
    slowestMs: Math.max(...perReqMs),
    fastestMs: Math.min(...perReqMs),
  };
}

// ── Inline styles ──────────────────────────────────────────────────────────────

const PAGE: CSSProperties = { padding: 24, fontFamily: 'monospace', fontSize: 13 };
const SECTION: CSSProperties = {
  border: '1px solid #d1d5db', borderRadius: 6, padding: 16,
  background: '#fafafa', marginBottom: 16,
};
const TH: CSSProperties = {
  textAlign: 'left', padding: '6px 12px', background: '#f3f4f6',
  border: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap',
};
const TD: CSSProperties = {
  padding: '6px 12px', border: '1px solid #e5e7eb', verticalAlign: 'top',
};
const INPUT_STYLE: CSSProperties = {
  border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 8px',
  width: 80, fontSize: 13, fontFamily: 'monospace',
};
const BTN_PRIMARY: CSSProperties = {
  background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4,
  padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
const BTN_DISABLED: CSSProperties = { ...BTN_PRIMARY, background: '#9ca3af', cursor: 'not-allowed' };
const STAMP: CSSProperties = {
  fontFamily: 'monospace', fontSize: 11, color: '#374151',
  background: '#f9fafb', border: '1px solid #e5e7eb',
  borderRadius: 4, padding: '6px 10px', marginBottom: 12,
  userSelect: 'all', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
};

// ── Cell display component ─────────────────────────────────────────────────────

function CellDisplay({ cell }: { cell: CellState }) {
  switch (cell.state) {
    case 'idle':
      return <span style={{ color: '#9ca3af' }}>—</span>;
    case 'running':
      return <span style={{ color: '#2563eb' }}>⋯</span>;
    case 'done':
      return (
        <div>
          <div style={{ fontWeight: 600 }}>{Math.round(cell.ms!)} ms</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            {cell.n} reqs · slow {Math.round(cell.slowest!)} ms · fast {Math.round(cell.fastest!)} ms
          </div>
        </div>
      );
    case 'error':
      return <span style={{ color: '#dc2626' }}>{cell.errorCode}</span>;
    case 'insufficientHistory':
      return <span style={{ color: '#9ca3af', fontSize: 11 }}>n/a — insufficient history</span>;
  }
}

// ── Helpers: load API data ────────────────────────────────────────────────────

async function fetchExtent(): Promise<TrendExtent> {
  const res  = await fetch('/api/v1/trends/extent');
  const body = await res.json() as { ok: boolean; data?: TrendExtent; error?: { message: string } };
  if (!body.ok || !body.data) throw new Error(body.error?.message ?? 'extent fetch failed');
  return body.data;
}

async function fetchTrendableTags(): Promise<TrendableTag[]> {
  const res  = await fetch('/api/v1/tags/trendable');
  const body = await res.json() as { ok: boolean; data?: { tags: TrendableTag[] }; error?: { message: string } };
  if (!body.ok || !body.data) throw new Error(body.error?.message ?? 'trendable tags fetch failed');
  return body.data.tags;
}

// ── Helper: initial result map ────────────────────────────────────────────────

function initResultMap(): Map<string, RowResult> {
  const m = new Map<string, RowResult>();
  for (const row of ROWS) {
    m.set(row.label, { live: { state: 'idle' }, historical: { state: 'idle' } });
  }
  return m;
}

// ── Page component ────────────────────────────────────────────────────────────

type LoadState<T> = T | 'loading' | { error: string };

function isLoaded<T>(s: LoadState<T>): s is T {
  return s !== 'loading' && !(typeof s === 'object' && 'error' in (s as object));
}

export function TrendsPerfTestPage() {
  const [extent,       setExtent]       = useState<LoadState<TrendExtent>>('loading');
  const [tagList,      setTagList]      = useState<LoadState<TrendableTag[]>>('loading');
  const [inputs,       setInputs]       = useState<Inputs>({ pointsPerTile: DEFAULT_BUCKET_COUNT, nTiles: DEFAULT_VISIBLE_TILES, tagCount: 8 });
  const [results,      setResults]      = useState<Map<string, RowResult>>(initResultMap);
  const [sweepRunning, setSweepRunning] = useState(false);
  const [runStamp,     setRunStamp]     = useState<string | null>(null);

  // Load extent + trendable tags in parallel on mount.
  useEffect(() => {
    Promise.all([fetchExtent(), fetchTrendableTags()])
      .then(([ext, tags]) => {
        setExtent(ext);
        setTagList(tags);
      })
      .catch((e: unknown) => {
        const msg = (e as Error).message;
        setExtent({ error: msg });
        setTagList({ error: msg });
      });
  }, []);

  const extentReady  = isLoaded(extent);
  const tagsReady    = isLoaded(tagList);
  const tagCount     = tagsReady ? (tagList as TrendableTag[]).length : 0;
  const hasData      = extentReady && (extent as TrendExtent).oldestTs !== null;
  const canRun       = !sweepRunning && extentReady && tagsReady && tagCount > 0;

  const nTiles       = inputs.nTiles;
  const nTagGroups   = Math.ceil(Math.min(inputs.tagCount, tagCount) / 8);
  const totalReqsCell = nTiles * nTagGroups;

  const runSweep = useCallback(async () => {
    if (!canRun) return;
    const ext    = extent as TrendExtent;
    const tags   = tagList as TrendableTag[];
    const stamp  = new Date().toISOString();
    const gitSha = (import.meta.env as Record<string, string | undefined>).VITE_GIT_SHA ?? 'unknown';

    setSweepRunning(true);
    setResults(initResultMap());

    const selectedTagIds = tags.slice(0, Math.min(inputs.tagCount, tags.length)).map(t => t.tag_id);

    for (const row of ROWS) {
      const { label, bucketS } = row;

      // ── Live cell ──────────────────────────────────────────────────────────
      setResults(prev => {
        const next = new Map(prev);
        next.set(label, { ...next.get(label)!, live: { state: 'running' } });
        return next;
      });

      const liveWindows = computeLiveTileWindows({
        nowMs: Date.now(), bucketS, pointsPerTile: inputs.pointsPerTile, nTiles,
      });

      const liveResult = await measureCell(liveWindows, selectedTagIds, inputs.pointsPerTile);

      setResults(prev => {
        const next = new Map(prev);
        const cur  = { ...next.get(label)! };
        cur.live = 'error' in liveResult
          ? { state: 'error', errorCode: liveResult.error }
          : { state: 'done', ms: liveResult.totalMs, n: liveResult.n,
              slowest: liveResult.slowestMs, fastest: liveResult.fastestMs };
        next.set(label, cur);
        return next;
      });

      // ── Historical cell ────────────────────────────────────────────────────
      setResults(prev => {
        const next = new Map(prev);
        next.set(label, { ...next.get(label)!, historical: { state: 'running' } });
        return next;
      });

      if (!hasData || ext.oldestTs === null || ext.newestTs === null) {
        setResults(prev => {
          const next = new Map(prev);
          next.set(label, { ...next.get(label)!, historical: { state: 'insufficientHistory' } });
          return next;
        });
      } else {
        const histWindows = computeHistoricalTileWindows({
          bucketS, pointsPerTile: inputs.pointsPerTile, nTiles,
          oldestMs: BigInt(Math.round(ext.oldestTs)),
          newestMs: BigInt(Math.round(ext.newestTs)),
        });

        if ('insufficientHistory' in histWindows) {
          setResults(prev => {
            const next = new Map(prev);
            next.set(label, { ...next.get(label)!, historical: { state: 'insufficientHistory' } });
            return next;
          });
        } else {
          const histResult = await measureCell(histWindows, selectedTagIds, inputs.pointsPerTile);
          setResults(prev => {
            const next = new Map(prev);
            const cur  = { ...next.get(label)! };
            cur.historical = 'error' in histResult
              ? { state: 'error', errorCode: histResult.error }
              : { state: 'done', ms: histResult.totalMs, n: histResult.n,
                  slowest: histResult.slowestMs, fastest: histResult.fastestMs };
            next.set(label, cur);
            return next;
          });
        }
      }
    }

    setSweepRunning(false);

    const extOldestIso = ext.oldestTs ? new Date(ext.oldestTs).toISOString() : 'empty';
    const extNewestIso = ext.newestTs ? new Date(ext.newestTs).toISOString() : 'empty';
    setRunStamp(
      `Run @ ${stamp} · git=${gitSha} · ` +
      `extent=${extOldestIso} → ${extNewestIso} · ` +
      `n_tiles=${nTiles} · n_tag_groups=${nTagGroups} · tag_count=${inputs.tagCount}`,
    );
  }, [canRun, extent, tagList, inputs, nTiles, nTagGroups, hasData]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const anyResults = [...results.values()].some(
    r => r.live.state !== 'idle' || r.historical.state !== 'idle',
  );

  return (
    <div style={PAGE}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
          Trends API — Performance Test
        </h1>
        <button
          style={canRun ? BTN_PRIMARY : BTN_DISABLED}
          disabled={!canRun}
          onClick={() => void runSweep()}
        >
          {sweepRunning ? 'Running…' : 'Go'}
        </button>
      </div>

      {/* ── Inputs ─────────────────────────────────────────────────────────── */}
      <div style={SECTION}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 600 }}>pointsPerTile</span>
            <input
              style={INPUT_STYLE}
              type="number"
              min={1}
              value={inputs.pointsPerTile}
              onChange={e => setInputs(p => ({ ...p, pointsPerTile: Math.max(1, parseInt(e.target.value, 10) || DEFAULT_BUCKET_COUNT) }))}
            />
            {inputs.pointsPerTile !== DEFAULT_BUCKET_COUNT && (
              <span style={{ fontSize: 11, color: '#d97706' }}>differs from client default ({DEFAULT_BUCKET_COUNT})</span>
            )}
            <span style={{ fontSize: 11, color: '#6b7280' }}>(range: 1–2500)</span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 600 }}>nTiles</span>
            <input
              style={INPUT_STYLE}
              type="number"
              min={1}
              value={inputs.nTiles}
              onChange={e => setInputs(p => ({ ...p, nTiles: Math.max(1, parseInt(e.target.value, 10) || DEFAULT_VISIBLE_TILES) }))}
            />
            <span style={{ fontSize: 11, color: '#6b7280' }}>(visible tiles per window; default {DEFAULT_VISIBLE_TILES})</span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 600 }}>tagCount</span>
            <input
              style={INPUT_STYLE}
              type="number"
              min={1}
              max={tagCount || 8}
              value={inputs.tagCount}
              onChange={e => setInputs(p => ({ ...p, tagCount: Math.max(1, Math.min(tagCount || 8, parseInt(e.target.value, 10) || 8)) }))}
            />
            {tagsReady && <span style={{ fontSize: 11, color: '#6b7280' }}>{tagCount} trendable tags loaded</span>}
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 600 }}>Computed</span>
            <span>n_tag_groups = {nTagGroups}</span>
            <span>reqs/cell = {totalReqsCell}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 600 }}>DB Extent</span>
            {extent === 'loading' && <span style={{ color: '#9ca3af' }}>loading…</span>}
            {isLoaded(extent) && (
              <>
                <span style={{ fontSize: 11 }}>
                  oldest: {(extent as TrendExtent).oldestTs != null
                    ? new Date((extent as TrendExtent).oldestTs!).toISOString()
                    : 'empty'}
                </span>
                <span style={{ fontSize: 11 }}>
                  newest: {(extent as TrendExtent).newestTs != null
                    ? new Date((extent as TrendExtent).newestTs!).toISOString()
                    : 'empty'}
                </span>
                {!hasData && <span style={{ fontSize: 11, color: '#dc2626' }}>DB empty — historical column unavailable</span>}
              </>
            )}
            {!isLoaded(extent) && extent !== 'loading' && (
              <span style={{ color: '#dc2626', fontSize: 11 }}>{(extent as { error: string }).error}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Run stamp ──────────────────────────────────────────────────────── */}
      {anyResults && runStamp && (
        <div style={STAMP}>{runStamp}</div>
      )}

      {/* ── Error banners ───────────────────────────────────────────────────── */}
      {!tagsReady && tagList !== 'loading' && (
        <div style={{ color: '#dc2626', marginBottom: 8 }}>
          Tags load error: {(tagList as { error: string }).error}
        </div>
      )}

      {/* ── Results table ──────────────────────────────────────────────────── */}
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={TH}>Row</th>
            <th style={TH}>bucket_s</th>
            <th style={TH}>window</th>
            <th style={TH}>Live ms</th>
            <th style={TH}>Hist ms</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(row => {
            const result     = results.get(row.label) ?? { live: { state: 'idle' as const }, historical: { state: 'idle' as const } };
            const windowSec  = row.bucketS * inputs.pointsPerTile * inputs.nTiles;
            return (
              <tr key={row.label}>
                <td style={{ ...TD, fontWeight: 500 }}>{row.label}</td>
                <td style={TD}>{row.bucketS} s</td>
                <td style={TD}>{formatDuration(windowSec)}</td>
                <td style={TD}><CellDisplay cell={result.live} /></td>
                <td style={TD}><CellDisplay cell={result.historical} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

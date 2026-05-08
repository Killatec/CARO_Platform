import { useState } from 'react';
import type { CSSProperties } from 'react';
import { MockHmiProvider } from '@caro/hmi-context';
import type { TagDef } from '@caro/hmi-context';
import { TrendChart } from '@caro/trend-chart';
import type { AggregateSeriesData, RawSeriesData } from '@caro/trend-chart';

// ── Fixture tag definitions ────────────────────────────────────────────────────

const TAG_DEFS: Record<number, TagDef> = {
  1: {
    tag_id: 1, tag_path: 'CARO_1.Beam.Temperature', data_type: 'float',
    is_setpoint: false, module_id: 'CARO_1', module_type: 'MQTT',
    eng_min: 0, eng_max: 100, unit: '°C', meta: [],
  },
  2: {
    tag_id: 2, tag_path: 'CARO_1.RF.Power_Output', data_type: 'float',
    is_setpoint: false, module_id: 'CARO_1', module_type: 'MQTT',
    eng_min: null, eng_max: null, unit: 'kW', meta: [],
  },
  3: {
    tag_id: 3, tag_path: 'CARO_1.Cooling.Valve_Open', data_type: 'bool',
    is_setpoint: false, module_id: 'CARO_1', module_type: 'MQTT',
    eng_min: null, eng_max: null, unit: null, meta: [],
  },
  4: {
    tag_id: 4, tag_path: 'CARO_1.Vacuum.Pressure', data_type: 'float',
    is_setpoint: false, module_id: 'CARO_1', module_type: 'MQTT',
    eng_min: 0, eng_max: 50, unit: 'bar', meta: [],
  },
};

// ── Aggregate fixture ─────────────────────────────────────────────────────────

const N = 250;
const BUCKET_MS = 14_400; // 14.4 s per bucket
const START_MS = 1_700_000_000_000n; // arbitrary fixed epoch
const END_MS = START_MS + BigInt(N) * BigInt(BUCKET_MS);

function buildAggregateSeries(): AggregateSeriesData {
  const tag1v: (number | null)[] = [];
  const tag1min: (number | null)[] = [];
  const tag1max: (number | null)[] = [];

  const tag2v: (number | null)[] = [];
  const tag2min: (number | null)[] = [];
  const tag2max: (number | null)[] = [];

  const tag3v: (number | null)[] = [];
  const tag3min: (number | null)[] = [];
  const tag3max: (number | null)[] = [];

  const tag4v: (number | null)[] = [];
  const tag4min: (number | null)[] = [];
  const tag4max: (number | null)[] = [];

  for (let k = 0; k < N; k++) {
    // Tag 1: sinusoidal temperature 20–80 °C, with a few nulls; ±5 °C band
    if (k === 40 || k === 41 || k === 120) {
      tag1v.push(null); tag1min.push(null); tag1max.push(null);
    } else {
      const v = 50 + 30 * Math.sin((k / N) * 2 * Math.PI);
      tag1v.push(v); tag1min.push(v - 5); tag1max.push(v + 5);
    }

    // Tag 2: autoscale — random walk around 5 kW; ±0.3 kW band
    const v2 = k === 0 ? 5.0 : Math.max(0, (tag2v[k - 1] ?? 5) + (Math.random() - 0.5) * 0.4);
    tag2v.push(v2); tag2min.push(v2 - 0.3); tag2max.push(v2 + 0.3);

    // Tag 3: boolean toggling every 30 buckets; no meaningful band (collapse to value)
    const v3 = Math.floor(k / 30) % 2 === 0 ? 1 : 0;
    tag3v.push(v3); tag3min.push(v3); tag3max.push(v3);

    // Tag 4: sawtooth 0–50 bar, with a null gap; ±2 bar band
    if (k >= 100 && k <= 110) {
      tag4v.push(null); tag4min.push(null); tag4max.push(null);
    } else {
      const v4 = ((k % 50) / 50) * 50;
      tag4v.push(v4); tag4min.push(v4 - 2); tag4max.push(v4 + 2);
    }
  }

  return {
    type: 'aggregate',
    source: '1min_cagg',
    startTime: START_MS,
    endTime: END_MS,
    n: N,
    bucketSMs: BUCKET_MS,
    series: new Map([
      [1, { value: tag1v, min: tag1min, max: tag1max }],
      [2, { value: tag2v, min: tag2min, max: tag2max }],
      [3, { value: tag3v, min: tag3min, max: tag3max }],
      [4, { value: tag4v, min: tag4min, max: tag4max }],
    ]),
  };
}

// ── Raw fixture ───────────────────────────────────────────────────────────────

function buildRawSeries(): RawSeriesData {
  // Sparse COV data: tag 1 has 5 points, tag 2 has 7 points, etc.
  const baseMs = Number(START_MS);

  const tag1Ts = [0, 60_000, 180_000, 400_000, 700_000].map(offset => BigInt(baseMs + offset));
  const tag1Values = [35.0, 42.5, null, 68.0, 55.0];

  const tag2Ts = [0, 90_000, 200_000, 350_000, 500_000, 600_000, 750_000].map(offset => BigInt(baseMs + offset));
  const tag2Values = [4.8, 5.1, 4.6, null, 5.4, 5.2, 4.9];

  const tag3Ts = [0, 120_000, 480_000].map(offset => BigInt(baseMs + offset));
  const tag3Values = [0, 1, 0];

  const tag4Ts = [0, 150_000, 400_000, 700_000].map(offset => BigInt(baseMs + offset));
  const tag4Values = [12.5, 25.0, null, 37.0];

  return {
    type: 'raw',
    source: 'raw',
    startTime: BigInt(baseMs),
    endTime: BigInt(baseMs + 800_000),
    series: new Map([
      [1, { ts: tag1Ts, value: tag1Values }],
      [2, { ts: tag2Ts, value: tag2Values }],
      [3, { ts: tag3Ts, value: tag3Values as (number | null)[] }],
      [4, { ts: tag4Ts, value: tag4Values }],
    ]),
  };
}

// ── Page styles ───────────────────────────────────────────────────────────────

const PAGE: CSSProperties = { padding: 24, fontFamily: 'monospace', fontSize: 13 };
const BTN: CSSProperties = {
  padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 4,
  cursor: 'pointer', fontFamily: 'monospace', fontSize: 12,
};
const BTN_ACTIVE: CSSProperties = { ...BTN, background: '#2563eb', color: '#fff', border: '1px solid #2563eb' };

// ── Page component ────────────────────────────────────────────────────────────

export function TrendChartTestPage() {
  const [mode, setMode] = useState<'aggregate' | 'raw'>('aggregate');
  const TAG_IDS = [1, 2, 3, 4];

  const data = mode === 'aggregate' ? buildAggregateSeries() : buildRawSeries();

  return (
    <MockHmiProvider tagDefs={TAG_DEFS}>
      <div style={PAGE}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>TrendChart — Dev Test</h1>
          <button style={mode === 'aggregate' ? BTN_ACTIVE : BTN} onClick={() => setMode('aggregate')}>
            Aggregate
          </button>
          <button style={mode === 'raw' ? BTN_ACTIVE : BTN} onClick={() => setMode('raw')}>
            Raw
          </button>
          <span style={{ color: '#6b7280', fontSize: 12 }}>
            {mode === 'aggregate'
              ? `${N} buckets × 14.4 s (1min_cagg) — 4 tags with gaps and mixed patterns`
              : 'Raw COV data — 4 tags, sparse timestamps, forward-filled in chart'}
          </span>
        </div>

        <TrendChart
          data={data}
          tagIds={TAG_IDS}
          siteTimezone="America/Chicago"
          height={420}
        />

        <div style={{ marginTop: 16, color: '#9ca3af', fontSize: 11 }}>
          Tag 1 (Temperature): sinusoidal 20–100°C, engineering range 0–100, 3 null gaps<br />
          Tag 2 (RF Power): random walk ~5 kW, autoscale (no engineering range)<br />
          Tag 3 (Valve Open): boolean, toggles every 30 buckets, Y-scale [-0.5, 1.5]<br />
          Tag 4 (Pressure): sawtooth 0–50 bar, engineering range 0–50, null gap at buckets 100–110
        </div>

      </div>
    </MockHmiProvider>
  );
}

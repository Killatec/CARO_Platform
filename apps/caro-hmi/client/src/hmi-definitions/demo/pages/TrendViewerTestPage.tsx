import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { TrendChartContainer } from '@caro/trend-chart';

// ── Layout ────────────────────────────────────────────────────────────────────

const PAGE: CSSProperties = { padding: 24, fontFamily: 'monospace', fontSize: 13 };
const HINT: CSSProperties = { color: '#9ca3af', fontSize: 11, marginTop: 8 };

// ── Trendable tag fetcher ─────────────────────────────────────────────────────

interface TrendableTag { tag_id: number; tag_path: string }

async function fetchTrendableTags(): Promise<TrendableTag[]> {
  const res = await fetch('/api/v1/tags/trendable');
  const json = await res.json() as { ok: boolean; data?: { tags: TrendableTag[] } };
  if (!json.ok || !json.data) return [];
  return json.data.tags;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function TrendViewerTestPage() {
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [allTags, setAllTags] = useState<TrendableTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTrendableTags()
      .then(tags => {
        setAllTags(tags);
        // Default: first 4 trendable tags (or all if fewer than 4).
        setTagIds(tags.slice(0, 4).map(t => t.tag_id));
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={PAGE}>Loading trendable tags…</div>;
  if (error) return <div style={PAGE} role="alert">Error: {error}</div>;
  if (tagIds.length === 0) {
    return (
      <div style={PAGE}>
        No trendable tags found. Ensure the HMI server is running and data has been written.
      </div>
    );
  }

  return (
    <div style={PAGE}>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>
        Trend Viewer — Live Dev Test
      </h1>
      <p style={HINT}>
        Tags: {tagIds.map(id => {
          const t = allTags.find(x => x.tag_id === id);
          return t ? `${id}:${t.tag_path.split('.').pop()}` : String(id);
        }).join(', ')}
        {' · '}Defaults: 1h tailing mode · Real REST data from /api/v1/trends/tile
      </p>

      <TrendChartContainer
        tagIds={tagIds}
        siteTimezone="America/New_York"
        width={900}
        height={420}
      />

      <div style={{ marginTop: 12, fontSize: 11, color: '#6b7280' }}>
        <strong>How to test:</strong> drag left → fixed mode · click preset or Go Live → tailing ·
        wheel-zoom anchors at cursor · shift+drag vertical pan · shift+wheel vertical zoom ·
        remove tag from legend · custom range far-past → fixed · custom range near-now → tailing
      </div>
    </div>
  );
}

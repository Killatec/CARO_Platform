import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { TrendChartContainer } from '@caro/trend-chart';

// ── Layout ────────────────────────────────────────────────────────────────────

const PAGE: CSSProperties = { padding: 24 };

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTrendableTags()
      .then(tags => {
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
      <TrendChartContainer
        tagIds={tagIds}
        siteTimezone="America/New_York"
        height={420}
      />
    </div>
  );
}

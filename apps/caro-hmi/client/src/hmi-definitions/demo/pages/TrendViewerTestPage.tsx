import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { TrendChartContainer } from '@caro/trend-chart';

// ── Layout ────────────────────────────────────────────────────────────────────

const PAGE: CSSProperties = { padding: 24 };

// ── Trendable tag fetcher (kept for server-reachability check and future use) ──

async function fetchTrendableTags(): Promise<void> {
  const res = await fetch('/api/v1/tags/trendable');
  const json = await res.json() as { ok: boolean };
  if (!json.ok) throw new Error('Trendable-tags endpoint returned ok=false');
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function TrendViewerTestPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTrendableTags()
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={PAGE}>Loading trendable tags…</div>;
  if (error) return <div style={PAGE} role="alert">Error: {error}</div>;

  return (
    <div style={PAGE}>
      <TrendChartContainer
        tagIds={[]}
        siteTimezone="America/New_York"
        height={420}
        persistKey="trend-viewer-test"
      />
    </div>
  );
}

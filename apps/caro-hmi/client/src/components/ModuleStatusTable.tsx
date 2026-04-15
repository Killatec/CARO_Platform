import { useState, useEffect, useCallback } from 'react';

interface ModuleStats {
  module_id: string;
  status: string;
  packets_per_sec: number;
  bytes_per_sec: number;
  tags_in_last_packet: number;
  stalled: boolean;
  last_seen_ms: number;
}

interface Props {
  refreshInterval?: number;
}

function statusClass(status: string): string {
  if (status === 'ONLINE') return 'text-green-600 font-medium';
  if (status === 'FAULT' || status === 'STALLED') return 'text-red-600 font-medium';
  return 'text-gray-400';
}

const PR: React.CSSProperties = { paddingRight: '3rem' };

export function ModuleStatusTable({ refreshInterval = 1000 }: Props) {
  const [modules, setModules] = useState<ModuleStats[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/modules/status');
      const json = await res.json() as { ok: boolean; data: ModuleStats[] };
      if (json.ok) setModules(json.data);
    } catch {
      // network error — keep stale data
    }
  }, []);

  // Polling interval — re-runs when refreshTick changes (immediate re-fetch on reset)
  useEffect(() => {
    void fetchStats();
    const id = setInterval(() => void fetchStats(), refreshInterval);
    return () => clearInterval(id);
  }, [fetchStats, refreshInterval, refreshTick]);

  // Listen for global watchdog reset signal from the header
  useEffect(() => {
    function handleReset() { setRefreshTick(t => t + 1); }
    window.addEventListener('system-reset', handleReset);
    return () => window.removeEventListener('system-reset', handleReset);
  }, []);

  return (
    <table className="text-sm border-collapse">
      <thead>
        <tr>
          <th className="text-left text-xs uppercase text-gray-500 font-medium pb-2" style={PR}>Module</th>
          <th className="text-center text-xs uppercase text-gray-500 font-medium pb-2" style={PR}>Status</th>
          <th className="text-center text-xs uppercase text-gray-500 font-medium pb-2" style={PR}>Packets/s</th>
          <th className="text-center text-xs uppercase text-gray-500 font-medium pb-2" style={PR}>KB/s</th>
          <th className="text-center text-xs uppercase text-gray-500 font-medium pb-2" style={PR}>Tags</th>
          <th className="text-center text-xs uppercase text-gray-500 font-medium pb-2">Watchdog</th>
        </tr>
      </thead>
      <tbody>
        {modules.length === 0 ? (
          <tr>
            <td colSpan={6} className="text-gray-400 text-xs py-2">No modules</td>
          </tr>
        ) : (
          modules.map(m => (
            <tr key={m.module_id} className="border-b border-gray-100">
              <td className="py-1.5 font-mono text-xs text-gray-800" style={PR}>{m.module_id}</td>
              <td className={`py-1.5 text-center ${statusClass(m.status)}`} style={PR}>{m.status}</td>
              <td className="py-1.5 text-center tabular-nums" style={PR}>{m.packets_per_sec}</td>
              <td className="py-1.5 text-center tabular-nums" style={PR}>{(m.bytes_per_sec / 1024).toFixed(1)}</td>
              <td className="py-1.5 text-center tabular-nums" style={PR}>{m.tags_in_last_packet}</td>
              <td className="py-1.5 text-center">
                <span
                  className={`inline-block w-3 h-3 rounded-full ${m.stalled ? 'bg-red-500' : 'bg-green-500'}`}
                />
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

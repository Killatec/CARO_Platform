import React, { useEffect, useState } from 'react';
import { Button, Badge } from '@caro/ui/primitives';
import { useSimulatorStore } from '../stores/useSimulatorStore.js';
import { getStatus, startSim, stopSim } from '../api/simulator.js';

const POLL_INTERVAL_MS = 2000;
const SIM_INTERVAL_MS  = 100;

export function SimulatorPanel() {
  const { running, intervalMs, tagCount, uptime_s, error, setStatus, setError } = useSimulatorStore();
  const [busy, setBusy] = useState(false);

  // Poll status every 2 s
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const data = await getStatus();
        if (!cancelled) setStatus(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  async function handleStart() {
    setBusy(true);
    try {
      await startSim(SIM_INTERVAL_MS);
      const data = await getStatus();
      setStatus(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    try {
      await stopSim();
      const data = await getStatus();
      setStatus(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">

      {/* Top bar — mirrors tag-registry AppShell header */}
      <header className="bg-gray-800 text-white px-6 py-3 flex items-center gap-6 shadow-lg">
        <h1 className="text-xl font-bold flex-shrink-0">MQTT Simulator</h1>

        <Badge variant={running ? 'success' : 'default'} className="text-sm px-3 py-1">
          {running ? 'RUNNING' : 'STOPPED'}
        </Badge>

        <div className="flex items-center gap-2 ml-auto">
          {!running ? (
            <Button variant="primary" onClick={handleStart} disabled={busy}>
              Start
            </Button>
          ) : (
            <Button variant="danger" onClick={handleStop} disabled={busy}>
              Stop
            </Button>
          )}
        </div>
      </header>

      {/* Status panel */}
      <main className="flex-1 overflow-auto p-8">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm max-w-lg">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Simulator Status</h2>
          </div>
          <dl className="divide-y divide-gray-100">
            <StatusRow label="State"       value={running ? 'Running' : 'Stopped'} highlight={running} />
            <StatusRow label="Interval"    value={intervalMs != null ? `${intervalMs} ms` : '—'} />
            <StatusRow label="Tags"        value={tagCount ?? '—'} />
            <StatusRow label="Uptime"      value={running ? formatUptime(uptime_s) : '—'} />
          </dl>
        </div>
      </main>
    </div>
  );
}

function StatusRow({ label, value, highlight = false }) {
  return (
    <div className="px-6 py-3 flex items-center justify-between">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className={`text-sm font-medium ${highlight ? 'text-green-600' : 'text-gray-900'}`}>{value}</dd>
    </div>
  );
}

function formatUptime(s) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

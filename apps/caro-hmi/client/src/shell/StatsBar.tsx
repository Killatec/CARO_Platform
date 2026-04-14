import { useState, useEffect } from 'react';
import { useWsStats, useResolveAssetPath, useLiveValue } from '@caro/hmi-context';

interface StatsBarProps {
  visible: boolean;
}

interface MetricProps {
  label: string;
  value: string;
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-gray-400 leading-none">
        {label}
      </span>
      <span className="text-xs text-gray-700 leading-none font-mono">
        {value}
      </span>
    </div>
  );
}

export function StatsBar({ visible }: StatsBarProps) {
  const { connected, latencyMs, messagesPerSec, bytesPerSec, subscribedCount } = useWsStats();

  // Render FPS — rAF loop, runs once, cleans up on unmount
  const [fps, setFps] = useState<number>(0);
  useEffect(() => {
    let rafId: number;
    let frameCount = 0;
    let lastTime = performance.now();

    const tick = () => {
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setFps(frameCount);
        frameCount = 0;
        lastTime = now;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // CPU tag — hooks must be called unconditionally before any early return
  const cpuTags = useResolveAssetPath('HMI.Telemetry_CPU');
  const cpuTagId = cpuTags.length > 0 ? cpuTags[0].tag_id : -1;
  const cpuLive = useLiveValue(cpuTagId);

  if (!visible) return null;

  const cpuValue = cpuTagId === -1 || cpuLive.value === null
    ? '—'
    : typeof cpuLive.value === 'number'
      ? `${cpuLive.value.toFixed(1)} %`
      : String(cpuLive.value);

  const connectionLabel = connected ? 'Connected' : 'Disconnected';
  const dotColor = connected ? 'bg-green-500' : 'bg-red-500';
  const latencyValue = latencyMs !== null ? `${latencyMs} ms` : '—';
  const dataRateValue = `${(bytesPerSec / 1024).toFixed(1)} KB/s`;

  return (
    <div className="flex items-center gap-6 border-b border-gray-200 bg-gray-100 h-8 flex-shrink-0" style={{ paddingLeft: '1.4rem', paddingRight: '1rem' }}>
      {/* CONNECTION — dot + label as a single metric */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[10px] uppercase tracking-widest text-gray-400 leading-none">
          Connection
        </span>
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
          <span className="text-xs text-gray-700 leading-none font-mono">
            {connectionLabel}
          </span>
        </div>
      </div>

      <Metric label="Latency" value={latencyValue} />
      <Metric label="Render" value={`${fps} FPS`} />
      <Metric label="Rate" value={`${messagesPerSec} Hz`} />
      <Metric label="Data Rate" value={dataRateValue} />
      <Metric label="Subscribed" value={`${subscribedCount} Tags`} />
      <Metric label="Svr CPU" value={cpuValue} />
    </div>
  );
}

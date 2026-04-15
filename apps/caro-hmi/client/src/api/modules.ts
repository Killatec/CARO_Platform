export async function resetWatchdogs(): Promise<void> {
  const res = await fetch('/api/v1/modules/watchdog/reset', { method: 'POST' });
  const json = await res.json() as { ok: boolean };
  if (!json.ok) throw new Error('resetWatchdogs failed');
}

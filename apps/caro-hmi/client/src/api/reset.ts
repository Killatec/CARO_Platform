export async function resetAll(): Promise<void> {
  const res = await fetch('/api/v1/reset', { method: 'POST' });
  const json = await res.json() as { ok: boolean };
  if (!json.ok) throw new Error('resetAll failed');
}

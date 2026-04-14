import { useState, useEffect } from 'react';

export const DEFAULT_WRITE_GUARD_TIMEOUT_MS = 1000;

export interface WriteGuardOptions {
  /** Timeout in ms before clearing awaitedValue if telemetry never arrives. Default: 1000 */
  timeoutMs?: number;
}

export function useWriteGuard(
  _tagId: number,
  liveValue: unknown,
  writeError: string | null,
  options?: WriteGuardOptions,
): {
  awaitedValue: unknown;
  setAwaitedValue: (value: unknown) => void;
  isWriting: boolean;
} {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_WRITE_GUARD_TIMEOUT_MS;

  const [awaitedValue, setAwaitedValue] = useState<unknown>(null);

  // Clear awaitedValue once telemetry confirms the written value.
  useEffect(() => {
    if (awaitedValue !== null && liveValue === awaitedValue) {
      setAwaitedValue(null);
    }
  }, [liveValue, awaitedValue]);

  // Clear awaitedValue immediately when the write reports an error.
  useEffect(() => {
    if (awaitedValue !== null && writeError !== null) {
      setAwaitedValue(null);
    }
  }, [writeError, awaitedValue]);

  // Safety timeout: if telemetry never arrives, release the lock.
  useEffect(() => {
    if (awaitedValue === null) return;
    const timer = setTimeout(() => setAwaitedValue(null), timeoutMs);
    return () => clearTimeout(timer);
  }, [awaitedValue, timeoutMs]);

  return { awaitedValue, setAwaitedValue, isWriting: awaitedValue !== null };
}

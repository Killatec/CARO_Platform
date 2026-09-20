import { useCallback, useState } from 'react';
import { useHmiContext } from './useHmiContext.js';

interface CommandSenderResult {
  send: (moduleId: string, cmdStr: string) => Promise<void>;
  isPending: (moduleId: string, cmdStr: string) => boolean;
  error: (moduleId: string, cmdStr: string) => string | null;
}

export function useCommandSender(): CommandSenderResult {
  const ctx = useHmiContext();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors]   = useState<Record<string, string | null>>({});

  const send = useCallback(
    async (moduleId: string, cmdStr: string): Promise<void> => {
      const key = `${moduleId}:${cmdStr}`;
      setPending(prev => ({ ...prev, [key]: true }));
      setErrors(prev => ({ ...prev, [key]: null }));
      try {
        await ctx.sendCommand(moduleId, cmdStr);
      } catch (e) {
        setErrors(prev => ({ ...prev, [key]: e instanceof Error ? e.message : String(e) }));
      } finally {
        setPending(prev => ({ ...prev, [key]: false }));
      }
    },
    [ctx]
  );

  const isPending = useCallback(
    (moduleId: string, cmdStr: string) => !!pending[`${moduleId}:${cmdStr}`],
    [pending]
  );

  const error = useCallback(
    (moduleId: string, cmdStr: string) => errors[`${moduleId}:${cmdStr}`] ?? null,
    [errors]
  );

  return { send, isPending, error };
}

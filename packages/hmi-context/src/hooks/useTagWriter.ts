import { useCallback, useState } from 'react';
import { useHmiContext } from './useHmiContext.js';

interface TagWriterResult {
  write: (tagId: number, value: number | boolean | string) => Promise<void>;
  isPending: (tagId: number) => boolean;
  error: (tagId: number) => string | null;
}

export function useTagWriter(): TagWriterResult {
  const ctx = useHmiContext();
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [errors, setErrors] = useState<Record<number, string | null>>({});

  const write = useCallback(
    async (tagId: number, value: number | boolean | string): Promise<void> => {
      setPending(prev => ({ ...prev, [tagId]: true }));
      setErrors(prev => ({ ...prev, [tagId]: null }));
      try {
        await ctx.writeTag(tagId, value);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setErrors(prev => ({ ...prev, [tagId]: message }));
      } finally {
        setPending(prev => ({ ...prev, [tagId]: false }));
      }
    },
    [ctx]
  );

  const isPending = useCallback((tagId: number) => !!pending[tagId], [pending]);
  const error = useCallback((tagId: number) => errors[tagId] ?? null, [errors]);

  return { write, isPending, error };
}

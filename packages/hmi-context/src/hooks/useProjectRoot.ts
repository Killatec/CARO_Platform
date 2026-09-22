import { useHmiContext } from './useHmiContext.js';

export function useProjectRoot(): string | null {
  return useHmiContext().projectRoot;
}

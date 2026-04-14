import { useHmiContext } from './useHmiContext.js';
import type { WsStats } from '../types.js';

export function useWsStats(): WsStats {
  return useHmiContext().wsStats;
}

import { useContext } from 'react';
import { HmiStatsContext } from '../HmiContext.js';
import type { WsStats } from '../types.js';

export function useWsStats(): WsStats {
  const stats = useContext(HmiStatsContext);
  if (!stats) {
    throw new Error(
      'HMI hooks must be used within an HmiContextProvider or MockHmiProvider.'
    );
  }
  return stats;
}

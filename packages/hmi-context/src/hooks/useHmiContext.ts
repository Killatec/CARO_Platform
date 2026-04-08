import { useContext } from 'react';
import { HmiContext } from '../HmiContext.js';
import type { HmiContextValue } from '../types.js';

export function useHmiContext(): HmiContextValue {
  const ctx = useContext(HmiContext);
  if (!ctx) {
    throw new Error(
      'HMI hooks must be used within an HmiContextProvider or MockHmiProvider.'
    );
  }
  return ctx;
}

import { useContext } from 'react';
import { HmiDataContext } from '../HmiContext.js';
import type { HmiDataContextValue } from '../types.js';

export function useHmiContext(): HmiDataContextValue {
  const ctx = useContext(HmiDataContext);
  if (!ctx) {
    throw new Error(
      'HMI hooks must be used within an HmiContextProvider or MockHmiProvider.'
    );
  }
  return ctx;
}

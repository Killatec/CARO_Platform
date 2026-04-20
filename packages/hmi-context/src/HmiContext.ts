import { createContext } from 'react';
import type { HmiDataContextValue, WsStats } from './types.js';

/** Stable data context — subscribe/unsubscribe hooks read from here. */
export const HmiDataContext = createContext<HmiDataContextValue | null>(null);

/** Stats context — updates every 1 s; isolated so stats ticks never destabilise data consumers. */
export const HmiStatsContext = createContext<WsStats | null>(null);

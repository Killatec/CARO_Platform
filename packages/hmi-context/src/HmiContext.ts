import { createContext } from 'react';
import type { HmiContextValue } from './types.js';
export const HmiContext = createContext<HmiContextValue | null>(null);

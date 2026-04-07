import { create } from 'zustand';
import type { SimulatorStatus, ModuleStatus } from '../api/simulator.js';

interface SimulatorStore {
  running: boolean;
  modules: ModuleStatus[];
  intervalMs: number | null;
  uptime_s: number;
  tickCount: number;
  error: string | null;
  setStatus: (status: SimulatorStatus) => void;
  setError: (msg: string) => void;
}

export const useSimulatorStore = create<SimulatorStore>()((set) => ({
  running: false,
  modules: [],
  intervalMs: null,
  uptime_s: 0,
  tickCount: 0,
  error: null,

  setStatus: (status) => set({ ...status, error: null }),
  setError:  (msg)    => set({ error: msg }),
}));

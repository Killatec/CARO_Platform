import { create } from 'zustand';

export const useSimulatorStore = create((set) => ({
  running:    false,
  intervalMs: null,
  tagCount:   0,
  uptime_s:   0,
  error:      null,

  setStatus: (status) => set({ ...status, error: null }),
  setError:  (msg)    => set({ error: msg }),
}));

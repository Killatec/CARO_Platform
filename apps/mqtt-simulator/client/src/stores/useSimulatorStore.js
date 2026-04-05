import { create } from 'zustand';

export const useSimulatorStore = create((set) => ({
  running: false,
  modules: [],
  error:   null,

  setStatus: (status) => set({ ...status, error: null }),
  setError:  (msg)    => set({ error: msg }),
}));

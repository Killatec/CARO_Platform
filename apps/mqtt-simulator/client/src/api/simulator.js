import { apiClient } from './client.js';

export const getStatus = ()            => apiClient.get('/simulator/status');
export const startSim  = (intervalMs)  => apiClient.post('/simulator/start', intervalMs != null ? { intervalMs } : {});
export const stopSim   = ()            => apiClient.post('/simulator/stop', {});

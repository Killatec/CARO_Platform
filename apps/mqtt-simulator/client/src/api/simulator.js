import { apiClient } from '@caro/ui/api/client';

export const getStatus = ()            => apiClient.get('/simulator/status');
export const startSim  = (intervalMs)  => apiClient.post('/simulator/start', intervalMs != null ? { intervalMs } : {});
export const stopSim   = ()            => apiClient.post('/simulator/stop', {});

export const stopModuleTelemetry  = (moduleId) => apiClient.post(`/simulator/telemetry/stop/${moduleId}`, {});
export const startModuleTelemetry = (moduleId) => apiClient.post(`/simulator/telemetry/start/${moduleId}`, {});

export const enableModuleDelta  = (moduleId) => apiClient.post(`/simulator/delta/enable/${moduleId}`, {});
export const disableModuleDelta = (moduleId) => apiClient.post(`/simulator/delta/disable/${moduleId}`, {});

export const getLogs = () => apiClient.get('/simulator/logs');

export const enableModuleProtobuf  = (moduleId) => apiClient.post(`/simulator/protobuf/enable/${moduleId}`, {});
export const disableModuleProtobuf = (moduleId) => apiClient.post(`/simulator/protobuf/disable/${moduleId}`, {});

export const requestSnapshot  = (moduleId) => apiClient.post(`/simulator/snapshot/${moduleId}`, {});
export const injectSetValues  = (moduleId) => apiClient.post(`/simulator/inject/${moduleId}`, {});

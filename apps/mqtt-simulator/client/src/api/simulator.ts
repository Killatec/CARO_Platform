import { apiClient } from '@caro/ui/api/client';

export interface ModuleStatus {
  module_id: string;
  active: boolean;
  tag_count: number;
  bytes: number;
  delta: boolean;
  protobuf: boolean;
  acceptSets: boolean;
  skipAck: boolean;
  fault: boolean;
}

export interface SimulatorStatus {
  running: boolean;
  intervalMs: number | null;
  modules: ModuleStatus[];
  uptime_s: number;
  tickCount: number;
}

export interface LogEntry {
  ts: string;
  level: string;
  msg: string;
}

export const getStatus = (): Promise<SimulatorStatus>  => apiClient.get<SimulatorStatus>('/simulator/status');
export const startSim  = (intervalMs?: number): Promise<unknown> => apiClient.post('/simulator/start', intervalMs != null ? { intervalMs } : {});
export const stopSim   = (): Promise<unknown>           => apiClient.post('/simulator/stop', {});

export const stopModuleTelemetry  = (moduleId: string): Promise<unknown> => apiClient.post(`/simulator/telemetry/stop/${moduleId}`, {});
export const startModuleTelemetry = (moduleId: string): Promise<unknown> => apiClient.post(`/simulator/telemetry/start/${moduleId}`, {});

export const enableModuleDelta  = (moduleId: string): Promise<unknown> => apiClient.post(`/simulator/delta/enable/${moduleId}`, {});
export const disableModuleDelta = (moduleId: string): Promise<unknown> => apiClient.post(`/simulator/delta/disable/${moduleId}`, {});

export const getLogs = (): Promise<LogEntry[]> => apiClient.get<LogEntry[]>('/simulator/logs');

export const enableModuleProtobuf  = (moduleId: string): Promise<unknown> => apiClient.post(`/simulator/protobuf/enable/${moduleId}`, {});
export const disableModuleProtobuf = (moduleId: string): Promise<unknown> => apiClient.post(`/simulator/protobuf/disable/${moduleId}`, {});

export const enableAcceptSets  = (moduleId: string): Promise<unknown> => apiClient.post(`/simulator/accept-sets/${moduleId}/activate`, {});
export const disableAcceptSets = (moduleId: string): Promise<unknown> => apiClient.post(`/simulator/accept-sets/${moduleId}/deactivate`, {});

export const enableSkipAck  = (moduleId: string): Promise<unknown> => apiClient.post(`/simulator/skip-ack/${moduleId}/activate`, {});
export const disableSkipAck = (moduleId: string): Promise<unknown> => apiClient.post(`/simulator/skip-ack/${moduleId}/deactivate`, {});

export const enableModuleFault  = (moduleId: string): Promise<unknown> => apiClient.post(`/simulator/fault/enable/${moduleId}`, {});
export const disableModuleFault = (moduleId: string): Promise<unknown> => apiClient.post(`/simulator/fault/disable/${moduleId}`, {});

export const requestSnapshot = (moduleId: string): Promise<unknown> => apiClient.post(`/simulator/snapshot/${moduleId}`, {});
export const injectSetValues = (moduleId: string): Promise<unknown> => apiClient.post(`/simulator/inject/${moduleId}`, {});

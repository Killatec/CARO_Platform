import React, { useEffect, useRef, useState } from 'react';
import { Button, Badge } from '@caro/ui/primitives';
import { useSimulatorStore } from '../stores/useSimulatorStore.js';
import { getStatus, startSim, stopSim, stopModuleTelemetry, startModuleTelemetry, enableModuleDelta, disableModuleDelta, enableModuleProtobuf, disableModuleProtobuf, enableAcceptSets, disableAcceptSets, enableSkipAck, disableSkipAck, enableModuleFault, disableModuleFault, getLogs, requestSnapshot, injectSetValues, ModuleStatus, LogEntry } from '../api/simulator.js';

const STATUS_POLL_MS  = 200;
const LOG_POLL_MS     = 2000;
const SIM_INTERVAL_MS = 100;

export const SimulatorPanel: React.FC = () => {
  const { running, modules, error, setStatus, setError } = useSimulatorStore();
  const [busy, setBusy] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef      = useRef<HTMLDivElement | null>(null);
  const userScrolledRef = useRef<boolean>(false);

  // Poll status every 2 s
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const data = await getStatus();
        if (!cancelled) setStatus(data);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }

    poll();
    const id = setInterval(poll, STATUS_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Poll logs every 2 s independently
  useEffect(() => {
    let cancelled = false;

    async function pollLogs() {
      try {
        const entries = await getLogs();
        if (!cancelled) setLogs(entries);
      } catch {
        // silently ignore log fetch errors
      }
    }

    pollLogs();
    const id = setInterval(pollLogs, LOG_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Auto-scroll to bottom when logs update, unless user scrolled up
  useEffect(() => {
    if (!userScrolledRef.current && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'instant' });
    }
  }, [logs]);

  async function handleStart() {
    setBusy(true);
    try {
      await startSim(SIM_INTERVAL_MS);
      const data = await getStatus();
      setStatus(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestSnapshot(module: ModuleStatus) {
    try {
      await requestSnapshot(module.module_id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleInjectSetValues(module: ModuleStatus) {
    try {
      await injectSetValues(module.module_id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleFaultToggle(module: ModuleStatus) {
    try {
      if (module.fault) {
        await disableModuleFault(module.module_id);
      } else {
        await enableModuleFault(module.module_id);
      }
      const data = await getStatus();
      setStatus(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSkipAckToggle(module: ModuleStatus) {
    try {
      if (module.skipAck) {
        await disableSkipAck(module.module_id);
      } else {
        await enableSkipAck(module.module_id);
      }
      const data = await getStatus();
      setStatus(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAcceptSetsToggle(module: ModuleStatus) {
    try {
      if (module.acceptSets) {
        await disableAcceptSets(module.module_id);
      } else {
        await enableAcceptSets(module.module_id);
      }
      const data = await getStatus();
      setStatus(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleProtobufToggle(module: ModuleStatus) {
    try {
      if (module.protobuf) {
        await disableModuleProtobuf(module.module_id);
      } else {
        await enableModuleProtobuf(module.module_id);
      }
      const data = await getStatus();
      setStatus(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeltaToggle(module: ModuleStatus) {
    try {
      if (module.delta) {
        await disableModuleDelta(module.module_id);
      } else {
        await enableModuleDelta(module.module_id);
      }
      const data = await getStatus();
      setStatus(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleModuleToggle(module: ModuleStatus) {
    try {
      if (module.active) {
        await stopModuleTelemetry(module.module_id);
      } else {
        await startModuleTelemetry(module.module_id);
      }
      const data = await getStatus();
      setStatus(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleStop() {
    setBusy(true);
    try {
      await stopSim();
      const data = await getStatus();
      setStatus(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">

      {/* Top bar — mirrors tag-registry AppShell header */}
      <header className="bg-gray-800 text-white px-6 py-3 flex items-center gap-6 shadow-lg">
        <h1 className="text-xl font-bold flex-shrink-0">MQTT Simulator</h1>

        <Badge variant={running ? 'success' : 'default'} className="text-sm px-3 py-1">
          {running ? 'RUNNING' : 'STOPPED'}
        </Badge>

        <div className="flex items-center gap-2 ml-auto">
          {!running ? (
            <Button variant="primary" onClick={handleStart} disabled={busy}>
              Start
            </Button>
          ) : (
            <Button variant="danger" onClick={handleStop} disabled={busy}>
              Stop
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-auto p-8">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        {modules.length > 0 && (
          <div className={`bg-white border border-gray-200 rounded-lg shadow-sm max-w-5xl transition-opacity ${!running ? 'opacity-40' : ''}`}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Modules</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-6 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Module</th>
                  <th className="px-6 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Tags</th>
                  <th className="px-6 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Bytes</th>
                  <th className="px-6 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Transmitting</th>
                  <th className="px-6 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Delta</th>
                  <th className="px-6 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Protobuf</th>
                  <th className="px-6 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Accept Sets</th>
                  <th className="px-6 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Skip ACK</th>
                  <th className="px-6 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Fault</th>
                  <th className="px-6 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {modules.map(module => (
                  <tr key={module.module_id}>
                    <td className="px-6 py-3 font-medium text-gray-900">{module.module_id}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{module.tag_count}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{module.bytes}</td>
                    <td className="px-6 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={module.active}
                        disabled={!running}
                        onChange={() => handleModuleToggle(module)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="px-6 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={module.delta}
                        disabled={!running}
                        onChange={() => handleDeltaToggle(module)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="px-6 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={module.protobuf}
                        disabled={!running}
                        onChange={() => handleProtobufToggle(module)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="px-6 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={module.acceptSets}
                        disabled={!running}
                        onChange={() => handleAcceptSetsToggle(module)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="px-6 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={module.skipAck}
                        disabled={!running}
                        onChange={() => handleSkipAckToggle(module)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="px-6 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={module.fault}
                        disabled={!running}
                        onChange={() => handleFaultToggle(module)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          disabled={!running}
                          onClick={() => handleRequestSnapshot(module)}
                          className="px-2 py-1 text-xs font-medium rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Rqst Snapshot
                        </button>
                        <button
                          disabled={!running}
                          onClick={() => handleInjectSetValues(module)}
                          className="px-2 py-1 text-xs font-medium rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Change Sets
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Logs */}
        <div className="mt-6 max-w-5xl">
          <div className="mb-1 px-1">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Logs</h2>
          </div>
          <div
            className="h-64 overflow-y-auto rounded-lg bg-gray-900 px-4 py-3 font-mono text-xs"
            onScroll={(e) => {
              const el = e.currentTarget;
              userScrolledRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 10;
            }}
          >
            {logs.length === 0 ? (
              <span className="text-gray-500">No log entries yet.</span>
            ) : (
              logs.map((entry, i) => (
                <div key={i} className="leading-5 whitespace-pre-wrap break-all">
                  <span className="text-gray-400">{entry.ts} </span>
                  <span className={
                    entry.level === 'ERROR' ? 'text-red-400' :
                    entry.level === 'WARN'  ? 'text-yellow-400' :
                    'text-gray-300'
                  }>[{entry.level}]</span>
                  <span className="text-gray-200"> {entry.msg}</span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </main>
    </div>
  );
};

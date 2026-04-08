/**
 * Kill processes listening on CARO_Platform dev ports.
 * Usage: node scripts/kill-ports.js
 *
 * Works on Windows (netstat + taskkill) and Linux/macOS (lsof + kill).
 */
import { execSync } from 'node:child_process';

const PORTS = [3001, 3002, 3003, 5173, 5174, 5175];

function killOnWindows(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const pids = new Set();
    for (const line of out.trim().split('\n')) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
        console.log(`  Killed PID ${pid} on port ${port}`);
      } catch { /* already dead */ }
    }
  } catch { /* nothing listening */ }
}

function killOnUnix(port) {
  try {
    const out = execSync(`lsof -ti :${port}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    for (const pid of out.trim().split('\n').filter(Boolean)) {
      try {
        execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
        console.log(`  Killed PID ${pid} on port ${port}`);
      } catch { /* already dead */ }
    }
  } catch { /* nothing listening */ }
}

const isWindows = process.platform === 'win32';
const kill = isWindows ? killOnWindows : killOnUnix;

console.log('Killing processes on ports:', PORTS.join(', '));
for (const port of PORTS) {
  kill(port);
}
console.log('Done.');

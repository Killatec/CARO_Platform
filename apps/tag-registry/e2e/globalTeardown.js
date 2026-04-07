import { execSync } from 'child_process';

/**
 * Kill a process tree by PID.
 * On Windows: taskkill /PID <pid> /F /T  (kills the shell + all its children)
 * On Unix:    SIGTERM to the process group
 */
function killTree(pid, label) {
  if (!pid) {
    console.warn(`[globalTeardown] No PID stored for ${label}, skipping.`);
    return;
  }

  console.log(`[globalTeardown] Killing ${label} (PID ${pid})...`);

  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
    } else {
      process.kill(parseInt(pid, 10), 'SIGTERM');
    }
  } catch (err) {
    // Process may have already exited — not a fatal error
    console.warn(`[globalTeardown] Could not kill ${label} PID ${pid}: ${err.message}`);
  }
}

export default async function globalTeardown() {
  killTree(process.env.__TEST_SERVER_PID, 'Express test server');
  killTree(process.env.__VITE_SERVER_PID, 'Vite test client');
  console.log('[globalTeardown] Done.');
}

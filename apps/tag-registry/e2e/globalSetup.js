import { spawn, execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const serverDir = path.resolve(__dirname, '../server');
const clientDir = path.resolve(__dirname, '../client');
const envTestPath = path.join(serverDir, '.env.test');

/**
 * Parse a .env file into a plain object. Ignores blank lines and # comments.
 */
function parseEnvFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

/**
 * Throws if the given TCP port is already bound. Resolves silently if free.
 */
function assertPortFree(port, label) {
  return new Promise((resolve, reject) => {
    import('net').then(({ createServer }) => {
      const server = createServer();
      server.once('error', () =>
        reject(new Error(
          `[globalSetup] Port ${port} is already in use (${label}). Free it before running E2E tests.`
        ))
      );
      server.once('listening', () => { server.close(); resolve(); });
      server.listen(port, '0.0.0.0');
    });
  });
}

/**
 * Poll url until it responds (any HTTP status) or timeout expires.
 */
async function waitForReady(url, label, timeoutMs = 30000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return;
    } catch {
      // ECONNREFUSED or request timeout — not ready yet
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`[globalSetup] Timeout after ${timeoutMs}ms waiting for ${label} at ${url}`);
}

export default async function globalSetup() {
  const testEnv = parseEnvFile(envTestPath);

  // TARGET_DB controls which database the test server connects to.
  // Defaults to caro_test (safe isolated clone). Set to caro_dev to skip
  // the clone step and run against the live development database.
  const targetDb = process.env.TARGET_DB ?? 'caro_test';

  // Env for pg cli tools — inherit everything, override PGPASSWORD
  const pgEnv = {
    ...process.env,
    PGPASSWORD: testEnv.PGPASSWORD ?? process.env.PGPASSWORD ?? '',
  };

  // ── Step 1: Clone caro_dev → targetDb (skipped when targeting caro_dev) ─────

  if (targetDb === 'caro_dev') {
    console.log('[globalSetup] TARGET_DB=caro_dev — skipping DB clone, using live database.');
  } else {
    const dumpPath = path.join(os.tmpdir(), 'caro_test_clone.dump').replace(/\\/g, '/');

    console.log(`[globalSetup] Dropping and recreating ${targetDb}...`);
    execSync(`psql -U postgres -c "DROP DATABASE IF EXISTS ${targetDb};"`, {
      env: pgEnv,
      stdio: 'inherit',
    });
    execSync(`psql -U postgres -c "CREATE DATABASE ${targetDb};"`, {
      env: pgEnv,
      stdio: 'inherit',
    });

    console.log(`[globalSetup] Dumping caro_dev → ${dumpPath} ...`);
    execSync(`pg_dump -U postgres -Fc caro_dev -f "${dumpPath}"`, {
      env: pgEnv,
      stdio: 'inherit',
    });

    console.log(`[globalSetup] Restoring dump into ${targetDb}...`);
    execSync(`pg_restore -U postgres -d ${targetDb} "${dumpPath}"`, {
      env: pgEnv,
      stdio: 'inherit',
    });
  }

  // ── Step 2: Start Express test server on port 3099 ──────────────────────────

  await assertPortFree(3099, 'Express test server');
  console.log(`[globalSetup] Starting Express test server on port 3099 (db: ${targetDb})...`);

  // PGDATABASE in serverEnv is overridden by targetDb, taking precedence over
  // whatever is set in .env.test.
  const serverEnv = { ...process.env, ...testEnv, NODE_ENV: 'test', PGDATABASE: targetDb };

  const serverProc = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: serverEnv,
    stdio: 'pipe',
    shell: true,
  });

  serverProc.stdout.on('data', d => process.stdout.write(`[server] ${d}`));
  serverProc.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
  serverProc.on('error', err => console.error('[globalSetup] Server process error:', err.message));

  // ── Step 3: Start Vite test client on port 5199 ─────────────────────────────

  await assertPortFree(5199, 'Vite test client');
  console.log('[globalSetup] Starting Vite test client on port 5199...');

  const viteProc = spawn('npx', ['vite', '--config', 'vite.test.config.ts'], {
    cwd: clientDir,
    env: process.env,
    stdio: 'pipe',
    shell: true,
  });

  viteProc.stdout.on('data', d => process.stdout.write(`[vite] ${d}`));
  viteProc.stderr.on('data', d => process.stderr.write(`[vite] ${d}`));
  viteProc.on('error', err => console.error('[globalSetup] Vite process error:', err.message));

  // Store PIDs for globalTeardown (shell PIDs — taskkill /T kills the whole tree)
  process.env.__TEST_SERVER_PID = String(serverProc.pid);
  process.env.__VITE_SERVER_PID = String(viteProc.pid);

  // ── Step 4: Wait for both servers to be ready ───────────────────────────────

  console.log('[globalSetup] Waiting for servers to be ready...');

  await Promise.all([
    waitForReady('http://localhost:3099/api/v1/config', 'Express server'),
    waitForReady('http://localhost:5199', 'Vite client'),
  ]);

  console.log('[globalSetup] Both servers ready. Running tests...');
}

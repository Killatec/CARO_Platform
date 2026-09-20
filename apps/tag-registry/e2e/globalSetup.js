import { spawn, execSync } from 'child_process';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { findWorkspaceRoot } from '@caro/server/env';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const serverDir = path.resolve(__dirname, '../server');
const clientDir = path.resolve(__dirname, '../client');
const envTestPath = path.join(serverDir, '.env.test');

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
  // Same precedence @caro/server/env's loadEnv() applies for every running
  // server, resolved the same way dotenv resolves it there: app-local
  // (.env.test) first, root .env filling in whatever is still unset — one
  // dotenv.config() call with an array `path`, earlier entries winning.
  // Reusing findWorkspaceRoot() (rather than re-deriving the root path) is
  // what keeps this resolution and loadEnv()'s from ever drifting apart.
  //
  // globalSetup itself never calls loadEnv() (it isn't a server, and it needs
  // these values as a plain object to build pgEnv/serverEnv from, not to
  // mutate its own process.env) — `processEnv` points dotenv at a throwaway
  // object instead of the real process.env, so this resolves POSTGRES_PASSWORD
  // and the other now-root-only keys with the exact same precedence, without
  // duplicating it by hand.
  const workspaceRoot = findWorkspaceRoot(__dirname);
  const rootEnvPath = workspaceRoot === null ? null : path.join(workspaceRoot, '.env');
  const fileEnv = {};
  dotenv.config({
    path: rootEnvPath === null ? [envTestPath] : [envTestPath, rootEnvPath],
    processEnv: fileEnv,
  });

  // TARGET_DB controls which database the test server connects to.
  // Defaults to caro_test (safe isolated clone). Set to caro_dev to skip
  // the clone step and run against the live development database.
  const targetDb = process.env.TARGET_DB ?? 'caro_test';

  // The clone source is whatever project database is currently live.
  // Precedence: an ambient POSTGRES_DATABASE (injected by a parent process)
  // beats the file-configured value, which beats the caro_dev default —
  // matching loadEnv()'s own precedence. Falling back to caro_dev keeps
  // behaviour unchanged when nothing is configured; reading the file-based
  // value (not just the ambient environment) means this still works now that
  // POSTGRES_DATABASE normally lives in the root .env rather than a shell var.
  const dumpSourceDb = process.env.POSTGRES_DATABASE ?? fileEnv.POSTGRES_DATABASE ?? 'caro_dev';

  // Env for pg cli tools — PGPASSWORD is the native PostgreSQL CLI convention.
  // Same precedence: ambient wins, then the file-resolved value, then empty.
  // Decided deliberately: .env.test no longer carries its own POSTGRES_PASSWORD
  // (moved to root, like every app's own .env), so this reads the root value
  // via the same dotenv.config() call above rather than keeping a second copy
  // in .env.test that could drift from it.
  const pgEnv = {
    ...process.env,
    PGPASSWORD: process.env.POSTGRES_PASSWORD ?? fileEnv.POSTGRES_PASSWORD ?? '',
  };

  // ── Step 1: Clone dumpSourceDb → targetDb (skipped when targeting it directly) ──

  if (targetDb === dumpSourceDb) {
    console.log(`[globalSetup] TARGET_DB=${targetDb} — skipping DB clone, using live database.`);
  } else {
    console.log(`[globalSetup] Seeding ${targetDb} from ${dumpSourceDb} (resolved from: ${process.env.POSTGRES_DATABASE ? 'ambient env' : fileEnv.POSTGRES_DATABASE ? 'root .env' : 'default'})`);

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

    console.log(`[globalSetup] Dumping ${dumpSourceDb} → ${dumpPath} ...`);
    execSync(`pg_dump -U postgres -Fc ${dumpSourceDb} -f "${dumpPath}"`, {
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

  // POSTGRES_DATABASE in serverEnv is overridden by targetDb, taking precedence over
  // the file-resolved value. PROJECT_ROOT is forced to '*' so the apply-gate
  // (server-side rootName check) doesn't reject the dynamically-named roots the
  // e2e suite creates per test. Spreading fileEnv (built from .env.test, not the
  // spawned server's real .env) here is what carries .env.test's own overrides
  // (e.g. PORT=3099) into the child — the spawned server's own loadEnv() call
  // reads its real app-local .env, never .env.test, so it wouldn't see those on
  // its own; the root-only keys (POSTGRES_*, etc.) would resolve either way,
  // since the child independently loads the same root .env at its own startup.
  const serverEnv = { ...process.env, ...fileEnv, NODE_ENV: 'test', POSTGRES_DATABASE: targetDb, PROJECT_ROOT: '*' };

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

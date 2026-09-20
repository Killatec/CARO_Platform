import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

export interface LoadEnvResult {
  /** Path this app's own .env would load from (process.cwd()/.env). */
  appEnvPath: string;
  /** Whether the app-local .env file exists. */
  appEnvLoaded: boolean;
  /** The monorepo root directory, or null if it could not be located. */
  workspaceRoot: string | null;
  /** Path the root .env would load from, or null if no workspace root was found. */
  rootEnvPath: string | null;
  /** Whether the root .env file exists. */
  rootEnvLoaded: boolean;
}

/**
 * Walks up from `startDir` (default process.cwd()) looking for the directory
 * whose package.json declares a "workspaces" key — the monorepo root. The
 * three server apps sit at three different depths below it, so this is
 * resolved dynamically rather than via a fixed relative path.
 *
 * Returns null (never throws) if no such ancestor exists before the
 * filesystem root. The only root-discovery implementation in the repo —
 * globalSetup.js imports this rather than re-deriving the same walk.
 */
export function findWorkspaceRoot(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg !== null && typeof pkg === 'object' && 'workspaces' in pkg) {
          return dir;
        }
      } catch {
        // Malformed package.json — keep walking up rather than failing here.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached the filesystem root
    dir = parent;
  }
}

/**
 * Loads environment variables for a server app in two layers: app-local
 * .env (process.cwd()/.env), then the monorepo root .env filling in
 * whatever is still unset.
 *
 * This is a single dotenv.config() call with an array `path` — dotenv
 * applies array entries in order and never overrides a variable already
 * present (an earlier array entry, or anything already in process.env
 * before this runs), so the array order alone *is* the precedence rule.
 * Never pass `override: true` here — that would make the root file
 * authoritative over per-app settings, the opposite of the intended
 * precedence, and would also defeat the parent-injected-env-wins case
 * (e.g. e2e's globalSetup) that this ordering depends on.
 *
 * No side effects at import time — the caller invokes this explicitly, once,
 * at the top of the app's entry point.
 */
export function loadEnv(): LoadEnvResult {
  const appEnvPath = path.join(process.cwd(), '.env');
  const workspaceRoot = findWorkspaceRoot();
  const rootEnvPath = workspaceRoot === null ? null : path.join(workspaceRoot, '.env');

  if (workspaceRoot === null) {
    console.warn(
      '[env] Could not locate the monorepo workspace root (no ancestor package.json ' +
      'declares a "workspaces" key) — loading app-local .env only.',
    );
  }

  // dotenv.config() itself doesn't report per-path success when given an
  // array (its `error` covers the whole batch) — these existence checks are
  // only for the diagnosable return value, not for enforcing precedence.
  const appEnvLoaded = existsSync(appEnvPath);
  const rootEnvLoaded = rootEnvPath !== null && existsSync(rootEnvPath);

  dotenv.config({ path: rootEnvPath === null ? [appEnvPath] : [appEnvPath, rootEnvPath] });

  return { appEnvPath, appEnvLoaded, workspaceRoot, rootEnvPath, rootEnvLoaded };
}

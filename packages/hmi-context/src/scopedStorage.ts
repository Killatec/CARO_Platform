import { useProjectRoot } from './hooks/useProjectRoot.js';

/**
 * Builds a project-scoped localStorage key: `caro.<projectRoot>.<name>`.
 *
 * A null projectRoot — /config hasn't resolved yet, or the fetch failed —
 * falls back to the `unknown` namespace rather than disabling persistence,
 * so a transient load-time gap doesn't cost a user their restored session
 * state. See Docs/hmi/hmi_deltas.md (multi-system UI selection).
 */
export function scopedKey(projectRoot: string | null, name: string): string {
  return `caro.${projectRoot ?? 'unknown'}.${name}`;
}

export function useScopedKey(name: string): string {
  return scopedKey(useProjectRoot(), name);
}

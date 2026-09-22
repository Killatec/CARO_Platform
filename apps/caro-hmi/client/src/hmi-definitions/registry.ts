import type { TreeNode } from '../shell/types.js';

/**
 * Explicit static map, not import.meta.glob — a missing tree fails at
 * compile time, and a system not selected at runtime stays out of the
 * loaded chunk (each entry is a dynamic import).
 */
export const hmiDefinitionsRegistry: Record<string, () => Promise<{ tree: TreeNode[] }>> = {
  Narya1: () => import('./Narya1/tree.js'),
  demo: () => import('./demo/tree.js'),
};

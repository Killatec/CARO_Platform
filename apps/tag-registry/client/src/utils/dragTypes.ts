import type { DragEvent } from 'react';
import type { TemplateEntry } from '@caro/tag-registry-shared';

// ── Drag payload types ────────────────────────────────────────────────────────

export type TreeDragData = {
  source: 'system-tree';
  parentTemplateName: string;
  childIndex: number;
  templateName: string;
};

export type TemplateDragData = {
  source: 'template-panel';
  templateName: string;
};

export type DragData = TreeDragData | TemplateDragData;

// ── Cycle prevention ──────────────────────────────────────────────────────────
//
// Reparenting a system-tree node adds an edge (targetParent -> draggedTemplate)
// to the template graph. That edge is only safe if targetParent is not already
// reachable from draggedTemplate (including draggedTemplate itself) — otherwise
// the graph gains a cycle. Templates can be shared (referenced from more than
// one parent), so this must walk the template graph itself, not the rendered
// tree position.

export function collectDescendantTemplateNames(
  startName: string,
  templateMap: Map<string, TemplateEntry>
): Set<string> {
  const result = new Set<string>();
  const stack = [startName];

  while (stack.length > 0) {
    const name = stack.pop()!;
    if (result.has(name)) continue;
    result.add(name);

    const template = templateMap.get(name)?.template;
    for (const child of template?.children ?? []) {
      if (child.template_name && !result.has(child.template_name)) {
        stack.push(child.template_name);
      }
    }
  }

  return result;
}

// ── Active-drag tracker ───────────────────────────────────────────────────────
//
// The HTML5 DnD spec prohibits reading dataTransfer values during dragover —
// only the MIME type list is accessible, not the data itself. We work around
// this by caching the active payload in a module-level variable that is set in
// onDragStart and cleared in onDragEnd. For system-tree drags, the set of
// unsafe drop targets (self + all descendants) is precomputed once at drag
// start so dragover — which fires on every pointer move — stays O(1).

let _activeDragData: DragData | null = null;
let _activeDragUnsafeTargets: Set<string> | null = null;

export function setActiveDragData(data: DragData, unsafeTargets?: Set<string>): void {
  _activeDragData = data;
  _activeDragUnsafeTargets = unsafeTargets ?? null;
}

export function clearActiveDragData(): void {
  _activeDragData = null;
  _activeDragUnsafeTargets = null;
}

export function getActiveDragData(): DragData | null {
  return _activeDragData;
}

export function getActiveDragUnsafeTargets(): Set<string> | null {
  return _activeDragUnsafeTargets;
}

// ── Drop-event parser ─────────────────────────────────────────────────────────
//
// Only usable inside an onDrop handler where dataTransfer is readable.
// Falls back to text/plain for legacy template-panel drags.

export function parseDragData(e: DragEvent): DragData | null {
  try {
    const json = e.dataTransfer.getData('application/json');
    if (json) {
      const parsed = JSON.parse(json) as DragData;
      if (parsed && typeof parsed === 'object' && 'source' in parsed) {
        return parsed;
      }
    }
  } catch {
    // fall through
  }

  const plain = e.dataTransfer.getData('text/plain');
  if (plain) {
    return { source: 'template-panel', templateName: plain };
  }

  return null;
}

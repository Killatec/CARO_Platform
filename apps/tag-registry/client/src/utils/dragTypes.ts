import type { DragEvent } from 'react';

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

// ── Active-drag tracker ───────────────────────────────────────────────────────
//
// The HTML5 DnD spec prohibits reading dataTransfer values during dragover —
// only the MIME type list is accessible, not the data itself. We work around
// this by caching the active payload in a module-level variable that is set in
// onDragStart and cleared in onDragEnd.

let _activeDragData: DragData | null = null;

export function setActiveDragData(data: DragData): void {
  _activeDragData = data;
}

export function clearActiveDragData(): void {
  _activeDragData = null;
}

export function getActiveDragData(): DragData | null {
  return _activeDragData;
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

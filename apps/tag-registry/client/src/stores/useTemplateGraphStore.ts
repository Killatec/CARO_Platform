import { create } from 'zustand';
import * as templatesApi from '../api/templates.js';
import type { BatchChange, BatchDeletion, BatchSaveResult } from '../api/templates.js';
import { applyFieldCascade, deepEqual } from '@caro/tag-registry-shared';
import type { Template, TemplateEntry, ValidationMessage } from '@caro/tag-registry-shared';
import { useUIStore } from './useUIStore.js';

export interface ValidationState {
  messages: ValidationMessage[];
  isValid: boolean;
}

export interface BatchSpec {
  changes: BatchChange[];
  deletions?: BatchDeletion[];
}

export interface TemplateGraphState {
  templateMap: Map<string, TemplateEntry>;
  originalTemplateMap: Map<string, TemplateEntry>;
  dirtySet: Set<string>;
  hashes: Map<string, string>;
  pendingDeletions: Set<string>;
  rootTemplateName: string | null;
  isLoading: boolean;
  error: string | null;
  validationState: ValidationState;

  loadRoot: (template_name: string | null | undefined) => Promise<void>;
  updateTemplate: (template_name: string, updates: Partial<Template>) => void;
  addTemplate: (template: Template, existingHash: string | null) => void;
  injectTemplateGraph: (templates: Record<string, TemplateEntry>) => void;
  markForDeletion: (name: string) => void;
  removeTemplate: (name: string) => void;
  save: (onRequiresConfirmation?: (result: BatchSaveResult, batch: BatchSpec) => void) => Promise<void>;
  confirmSave: (batch: BatchSpec) => Promise<void>;
  discard: () => Promise<void>;
  setValidationState: (state: ValidationState) => void;
}

/**
 * Isolation-mode reset helper.
 */
async function _resetToIsolationMode(
  get: () => TemplateGraphState,
  set: (partial: Partial<TemplateGraphState>) => void
): Promise<void> {
  const selectedTemplate = useUIStore.getState().selectedTemplateTree;
  const isNewTemplate = selectedTemplate &&
    !get().originalTemplateMap.has(selectedTemplate);

  set({
    templateMap: new Map(),
    originalTemplateMap: new Map(),
    hashes: new Map(),
    dirtySet: new Set(),
    pendingDeletions: new Set(),
  });

  if (selectedTemplate && !isNewTemplate) {
    const data = await templatesApi.loadRoot(selectedTemplate);
    if (data) get().injectTemplateGraph(data.templates);
  } else {
    useUIStore.getState().setSelectedTemplateTree(null);
  }
}

/**
 * Template graph store - manages client-side template graph
 *
 * NOTE — isDirty is NOT a store property.
 * Consumers must use an inline selector:
 *   state.dirtySet.size > 0 || state.pendingDeletions.size > 0
 */
export const useTemplateGraphStore = create<TemplateGraphState>((set, get) => ({
  // ── State ────────────────────────────────────────────────────────────────
  templateMap: new Map(),
  originalTemplateMap: new Map(),
  dirtySet: new Set(),
  hashes: new Map(),
  pendingDeletions: new Set(),
  rootTemplateName: null,
  isLoading: false,
  error: null,
  validationState: { messages: [], isValid: true },

  // ── Core data actions ─────────────────────────────────────────────────────

  loadRoot: async (template_name) => {
    set({ isLoading: true, error: null });
    try {
      const data = await templatesApi.loadRoot(template_name);
      const templateMap = new Map<string, TemplateEntry>();
      const hashes = new Map<string, string>();

      for (const [name, { template, hash }] of Object.entries(data!.templates)) {
        templateMap.set(name, { template, hash });
        if (hash) hashes.set(name, hash);
      }

      const originalTemplateMap = structuredClone(templateMap);

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('caro_last_root', data!.root_template_name);
      }

      set({
        templateMap,
        originalTemplateMap,
        hashes,
        rootTemplateName: data!.root_template_name,
        dirtySet: new Set(),
        pendingDeletions: new Set(),
        isLoading: false,
        error: null
      });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  updateTemplate: (template_name, updates) => {
    const { templateMap, originalTemplateMap } = get();

    const entry = templateMap.get(template_name);
    if (!entry) return;

    const updatedTemplate: Template = {
      ...entry.template,
      ...updates
    };

    const newTemplateMap = new Map(templateMap);
    newTemplateMap.set(template_name, {
      template: updatedTemplate,
      hash: entry.hash
    });

    const cascadedMap = applyFieldCascade(newTemplateMap, updatedTemplate);

    const originalEntry = originalTemplateMap.get(template_name);
    const isClean = originalEntry !== undefined &&
      deepEqual(updatedTemplate, originalEntry.template);

    set(state => {
      const newDirtySet = new Set(state.dirtySet);
      if (isClean) {
        newDirtySet.delete(template_name);
      } else {
        newDirtySet.add(template_name);
      }
      return {
        templateMap: cascadedMap instanceof Map
          ? cascadedMap as Map<string, TemplateEntry>
          : cascadedMap != null
            ? new Map(Object.entries(cascadedMap)) as Map<string, TemplateEntry>
            : newTemplateMap,
        dirtySet: newDirtySet,
      };
    });
  },

  addTemplate: (template, existingHash = null) => {
    const { templateMap, dirtySet, hashes } = get();

    const newTemplateMap = new Map(templateMap);
    newTemplateMap.set(template.template_name, {
      template,
      hash: existingHash
    });

    const newHashes = new Map(hashes);
    if (existingHash) newHashes.set(template.template_name, existingHash);

    const newDirtySet = new Set(dirtySet);
    newDirtySet.add(template.template_name);

    set({
      templateMap: newTemplateMap,
      hashes: newHashes,
      dirtySet: newDirtySet
    });
  },

  injectTemplateGraph: (templates) => set(state => {
    const newTemplateMap = new Map(state.templateMap);
    const newOriginalMap = new Map(state.originalTemplateMap);
    const newHashes = new Map(state.hashes);

    for (const [name, { template, hash }] of Object.entries(templates)) {
      if (!newTemplateMap.has(name)) {
        newTemplateMap.set(name, { template, hash });
      }
      if (!newOriginalMap.has(name)) {
        newOriginalMap.set(name, structuredClone({ template, hash }));
      }
      if (!newHashes.has(name) && hash) {
        newHashes.set(name, hash);
      }
    }

    return {
      templateMap: newTemplateMap,
      originalTemplateMap: newOriginalMap,
      hashes: newHashes,
    };
  }),

  // ── Deletion actions ──────────────────────────────────────────────────────

  markForDeletion: (name) => set(state => {
    const newTemplateMap = new Map(state.templateMap);
    const newDirtySet = new Set(state.dirtySet);
    const newPendingDeletions = new Set(state.pendingDeletions);

    newTemplateMap.delete(name);
    newDirtySet.delete(name);
    newPendingDeletions.add(name);

    return {
      templateMap: newTemplateMap,
      dirtySet: newDirtySet,
      pendingDeletions: newPendingDeletions,
    };
  }),

  removeTemplate: (name) => set(state => {
    const newTemplateMap = new Map(state.templateMap);
    const newOriginalMap = new Map(state.originalTemplateMap);
    const newHashes = new Map(state.hashes);
    const newDirtySet = new Set(state.dirtySet);
    const newPendingDeletions = new Set(state.pendingDeletions);

    newTemplateMap.delete(name);
    newOriginalMap.delete(name);
    newHashes.delete(name);
    newDirtySet.delete(name);
    newPendingDeletions.delete(name);

    return {
      templateMap: newTemplateMap,
      originalTemplateMap: newOriginalMap,
      hashes: newHashes,
      dirtySet: newDirtySet,
      pendingDeletions: newPendingDeletions,
    };
  }),

  // ── Save / discard actions ────────────────────────────────────────────────

  save: async (onRequiresConfirmation) => {
    const { dirtySet, pendingDeletions, templateMap, originalTemplateMap, hashes, validationState, rootTemplateName, loadRoot } = get();

    if (!validationState.isValid) return;
    if (dirtySet.size === 0 && pendingDeletions.size === 0) return;

    const changes: BatchChange[] = Array.from(dirtySet).map(template_name => {
      const entry = templateMap.get(template_name)!;
      const original_hash = hashes.get(template_name) ?? null;
      return { template_name, original_hash, template: entry.template };
    });

    const deletions: BatchDeletion[] = Array.from(pendingDeletions).map(name => ({
      template_name: name,
      original_hash: originalTemplateMap.get(name)?.hash ?? null,
    }));

    set({ isLoading: true, error: null });

    try {
      const result = await templatesApi.batchSave(changes, deletions, false);

      if (result.requires_confirmation) {
        if (onRequiresConfirmation) onRequiresConfirmation(result, { changes, deletions });
        set({ isLoading: false });
        return;
      }

      if (rootTemplateName) {
        await loadRoot(rootTemplateName);
      } else {
        await _resetToIsolationMode(get, set);
      }

      set({ isLoading: false });
    } catch (error) {
      const err = error as Error & { code?: string };
      if (err.code === 'STALE_TEMPLATE') {
        if (rootTemplateName) {
          await loadRoot(rootTemplateName);
        } else {
          await _resetToIsolationMode(get, set);
        }
        set({ error: 'Template was modified by another user. Local changes discarded.', isLoading: false });
      } else {
        set({ error: err.message, isLoading: false });
      }
    }
  },

  confirmSave: async (batch) => {
    const { rootTemplateName, loadRoot } = get();
    const { changes, deletions = [] } = batch;

    set({ isLoading: true, error: null });

    try {
      await templatesApi.batchSave(changes, deletions, true);

      if (rootTemplateName) {
        await loadRoot(rootTemplateName);
      } else {
        await _resetToIsolationMode(get, set);
      }
      set({ isLoading: false });
    } catch (error) {
      const err = error as Error & { code?: string };
      if (err.code === 'STALE_TEMPLATE') {
        if (rootTemplateName) {
          await loadRoot(rootTemplateName);
        } else {
          await _resetToIsolationMode(get, set);
        }
        set({ error: 'Template was modified by another user. Local changes discarded.', isLoading: false });
      } else {
        set({ error: err.message, isLoading: false });
      }
    }
  },

  discard: async () => {
    const { rootTemplateName, loadRoot } = get();

    if (rootTemplateName) {
      await loadRoot(rootTemplateName);
    } else {
      await _resetToIsolationMode(get, set);
    }
  },

  // ── Utility actions ───────────────────────────────────────────────────────

  setValidationState: (state) => set({ validationState: state }),
}));

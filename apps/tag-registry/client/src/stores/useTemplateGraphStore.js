import { create } from 'zustand';
import * as templatesApi from '../api/templates.js';
import { applyFieldCascade } from '../../../shared/index.js';
import { deepEqual } from '../../../shared/utils.js';
import { useUIStore } from './useUIStore.js';

/**
 * Isolation-mode reset helper.
 * Wipes all on-demand state (templateMap, originalTemplateMap, hashes,
 * dirtySet, pendingDeletions), then re-fetches and re-injects the currently
 * selected template's subgraph so the panel shows fresh server state.
 *
 * Called by save(), confirmSave(), and discard() whenever rootTemplateName
 * is null (isolation mode — no root template selected in the dropdown).
 * Specifically triggered on:
 *   - save() success (no confirmation needed)
 *   - save() STALE_TEMPLATE error
 *   - confirmSave() success
 *   - confirmSave() STALE_TEMPLATE error
 *   - discard()
 *
 * isNewTemplate is captured synchronously before set() wipes the store:
 * a template is new if selectedTemplateTree is set but has no entry in
 * originalTemplateMap (which is only populated at server-fetch time, never
 * for addTemplate-created templates). After the wipe, originalTemplateMap
 * is empty so this check would always return true — it must happen first.
 *
 * After the wipe:
 *   - Saved template (!isNewTemplate): loadRoot re-fetches the subgraph and
 *     injects it. selectedTemplateTree is left set — panel stays on the
 *     restored template.
 *   - New unsaved template (isNewTemplate): nothing to re-fetch — the
 *     template never existed on disk. selectedTemplateTree is cleared and
 *     the panel goes blank.
 */
async function _resetToIsolationMode(get, set) {
  const selectedTemplate = useUIStore.getState().selectedTemplateTree;
  // Capture before wiping — originalTemplateMap entry exists only for
  // templates previously fetched from the server.
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
    get().injectTemplateGraph(data.templates);
    // Leave selectedTemplateTree set — panel stays on the restored template.
  } else {
    // New unsaved template discarded — clear selection.
    useUIStore.getState().setSelectedTemplateTree(null);
  }
}

/**
 * Template graph store - manages client-side template graph
 *
 * NOTE — isDirty is NOT a store property.
 * Consumers must use an inline selector:
 *   state.dirtySet.size > 0 || state.pendingDeletions.size > 0
 * Do not add isDirty as a store function — it was removed because store
 * function properties are not reactive subscription targets and obscure
 * the actual state dependencies from Zustand's subscription machinery.
 */
export const useTemplateGraphStore = create((set, get) => ({
  // ── State ────────────────────────────────────────────────────────────────
  templateMap: new Map(), // Map<template_name, { template, hash }>
  originalTemplateMap: new Map(), // Map<template_name, { template, hash }> — snapshot at load time, never mutated
  dirtySet: new Set(), // Set<template_name>
  hashes: new Map(), // Map<template_name, original_hash>
  pendingDeletions: new Set(), // Set<template_name> — queued for deletion on Save
  rootTemplateName: null,
  isLoading: false,
  error: null,
  validationState: { messages: [], isValid: true }, // Set by useValidation hook

  // ── Core data actions ─────────────────────────────────────────────────────

  loadRoot: async (template_name) => {
    set({ isLoading: true, error: null });
    try {
      const data = await templatesApi.loadRoot(template_name);
      const templateMap = new Map();
      const hashes = new Map();

      for (const [name, { template, hash }] of Object.entries(data.templates)) {
        templateMap.set(name, { template, hash });
        hashes.set(name, hash);
      }

      const originalTemplateMap = structuredClone(templateMap);

      set({
        templateMap,
        originalTemplateMap,
        hashes,
        rootTemplateName: data.root_template_name,
        dirtySet: new Set(),
        pendingDeletions: new Set(),
        isLoading: false,
        error: null
      });
    } catch (error) {
      set({ error: error.message, isLoading: false });
    }
  },

  updateTemplate: (template_name, updates) => {
    const { templateMap, originalTemplateMap } = get();

    const entry = templateMap.get(template_name);
    if (!entry) return;

    const updatedTemplate = {
      ...entry.template,
      ...updates
    };

    const newTemplateMap = new Map(templateMap);
    newTemplateMap.set(template_name, {
      template: updatedTemplate,
      hash: entry.hash
    });

    // Apply field cascade if this is a structural change
    const cascadedMap = applyFieldCascade(newTemplateMap, updatedTemplate);

    // Re-evaluate dirty membership: remove if deeply equal to original baseline,
    // add if different. New templates with no originalTemplateMap entry are always dirty.
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
        templateMap: cascadedMap instanceof Map ? cascadedMap : new Map(Object.entries(cascadedMap)),
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

    // Store the hash so save() can send the correct original_hash
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

  // Inject a flat map of templates (e.g. from GET /templates/root/:name) into
  // templateMap and originalTemplateMap without touching dirtySet.
  // Never overwrites existing entries — preserves dirty edits and baselines.
  // Setting originalTemplateMap at fetch time (not edit time) is what makes
  // simulateCascade produce a real diff when the user clicks "See what's changed".
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

  /**
   * Queues a saved template for server-side deletion on the next Save.
   *
   * Removes from templateMap immediately so the tree and validation panel
   * reflect the deletion at once. Keeps in originalTemplateMap and hashes
   * so save() can include the correct original_hash in the deletions array.
   * Removes from dirtySet — deletion supersedes any pending field edits.
   *
   * Do NOT call for new unsaved templates (those with null hash / no
   * originalTemplateMap entry) — use removeTemplate() instead, which
   * discards them without needing a server round-trip.
   */
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

  /**
   * Immediately removes a template from ALL store maps atomically.
   *
   * Used for:
   *   - Instant client-side deletion of new unsaved templates (null hash)
   *   - Post-save / post-discard cleanup if ever needed
   *
   * Do NOT call for saved templates that should be deleted on the server —
   * use markForDeletion() instead so the deletion is included in the next
   * batch save with the correct original_hash.
   */
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

    const changes = Array.from(dirtySet).map(template_name => {
      const entry = templateMap.get(template_name);
      const original_hash = hashes.get(template_name) || null;
      return { template_name, original_hash, template: entry.template };
    });

    const deletions = Array.from(pendingDeletions).map(name => ({
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

      // Success — reset state and restore selection.
      if (rootTemplateName) {
        await loadRoot(rootTemplateName);
      } else {
        await _resetToIsolationMode(get, set);
      }

      set({ isLoading: false });
    } catch (error) {
      if (error.code === 'STALE_TEMPLATE') {
        if (rootTemplateName) {
          await loadRoot(rootTemplateName);
        } else {
          await _resetToIsolationMode(get, set);
        }
        set({ error: 'Template was modified by another user. Local changes discarded.', isLoading: false });
      } else {
        set({ error: error.message, isLoading: false });
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
      if (error.code === 'STALE_TEMPLATE') {
        if (rootTemplateName) {
          await loadRoot(rootTemplateName);
        } else {
          await _resetToIsolationMode(get, set);
        }
        set({ error: 'Template was modified by another user. Local changes discarded.', isLoading: false });
      } else {
        set({ error: error.message, isLoading: false });
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

  // Set validation state (called by useValidation hook)
  setValidationState: (state) => set({ validationState: state }),
}));

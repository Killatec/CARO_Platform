import React, { useEffect, useState, useRef } from 'react';
import { RegistryTable } from '../components/registry/RegistryTable.jsx';
import { ValidationPanel } from '../components/shared/ValidationPanel.jsx';
import { Modal } from '@caro/ui/primitives';
import { useTemplateGraphStore } from '../stores/useTemplateGraphStore.js';
import { useRegistryStore } from '../stores/useRegistryStore.js';
import { useValidation } from '../hooks/useValidation.js';
import { resolveRegistry } from '../../../shared/index.js';
import { fetchRegistry, applyRegistry } from '../api/registry.js';
import { diffRegistry } from '../utils/diffRegistry.js';

/**
 * RegistryPage - displays resolved tag registry with optional diff against DB
 */
export function RegistryPage() {
  const templateMap = useTemplateGraphStore(state => state.templateMap);
  const rootTemplateName = useTemplateGraphStore(state => state.rootTemplateName);
  const isDirty = useTemplateGraphStore(state => state.dirtySet.size > 0 || state.pendingDeletions.size > 0);
  const setTags = useRegistryStore(state => state.setTags);

  const { messages, isValid } = useValidation(templateMap, rootTemplateName);

  // Diff state
  const [diffRows, setDiffRows] = useState(null);
  const [dbRevision, setDbRevision] = useState(null);
  const [dbError, setDbError] = useState(null);

  // Apply modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [applyComment, setApplyComment] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState(null);

  // Success banner state
  const [successRev, setSuccessRev] = useState(null);
  const successTimerRef = useRef(null);

  // Core effect: resolve + diff
  useEffect(() => {
    if (!rootTemplateName || !templateMap || templateMap.size === 0) {
      setTags([]);
      setDiffRows(null);
      return;
    }

    if (!isValid) {
      setTags([]);
      setDiffRows(null);
      return;
    }

    const proposed = resolveRegistry(templateMap, rootTemplateName);
    setTags(proposed);

    setDbError(null);
    fetchRegistry()
      .then(dbTags => {
        setDiffRows(diffRegistry(proposed, dbTags));
        const rev = dbTags.length > 0 ? Math.max(...dbTags.map(t => t.registry_rev)) : null;
        setDbRevision(rev);
      })
      .catch(err => {
        setDbError(err.message || 'Failed to load database registry');
        setDiffRows(null);
        setDbRevision(null);
      });
  }, [templateMap, rootTemplateName, isValid, setTags]);

  // Re-fetch and re-diff after a successful apply
  function refreshDiff() {
    if (!rootTemplateName || !templateMap || templateMap.size === 0 || !isValid) return;
    const proposed = resolveRegistry(templateMap, rootTemplateName);
    setTags(proposed);
    fetchRegistry()
      .then(dbTags => setDiffRows(diffRegistry(proposed, dbTags)))
      .catch(err => setDbError(err.message || 'Failed to load database registry'));
  }

  if (!rootTemplateName) {
    return (
      <div className="w-fit flex flex-col overflow-auto p-6 text-center text-gray-500">
        <p>Select a root template from the dropdown above to view the registry.</p>
      </div>
    );
  }

  if (!isValid) {
    return (
      <div className="w-fit flex flex-col overflow-auto p-6 text-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-red-900 mb-2">
            Resolve errors to view registry
          </h3>
          <p className="text-sm text-red-700">
            The template graph has validation errors. Please fix them in the Editor before viewing the registry.
          </p>
        </div>
        <ValidationPanel messages={messages} />
      </div>
    );
  }

  // Diff summary counts
  const diffSummary = diffRows
    ? ['added', 'modified', 'unchanged', 'retired'].reduce((acc, s) => {
        acc[s] = diffRows.filter(r => r.diffStatus === s).length;
        return acc;
      }, {})
    : null;

  const hasChanges = !isDirty && diffSummary
    ? diffSummary.added > 0 || diffSummary.modified > 0 || diffSummary.retired > 0
    : false;

  function openModal() {
    setApplyComment('');
    setApplyError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setApplyComment('');
    setApplyError(null);
  }

  async function handleConfirmApply() {
    setApplying(true);
    setApplyError(null);
    try {
      const result = await applyRegistry(rootTemplateName, applyComment);
      setModalOpen(false);
      setApplyComment('');
      // Show success banner, auto-dismiss after 4 s
      setSuccessRev(result.registry_rev);
      clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSuccessRev(null), 4000);
      // Update revision immediately, then refresh diff
      setDbRevision(result.registry_rev);
      refreshDiff();
    } catch (err) {
      setApplyError(err.message || 'Failed to apply registry');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="w-fit flex flex-col overflow-auto">
      {/* DB error banner */}
      {dbError && (
        <div className="mx-4 mt-4 bg-amber-50 border border-amber-300 rounded p-3 text-sm text-amber-800">
          DB registry unavailable — showing proposed registry without diff. ({dbError})
        </div>
      )}

      {/* Success banner */}
      {successRev !== null && (
        <div className="mx-4 mt-4 bg-green-50 border border-green-300 rounded p-3 text-sm text-green-800">
          Registry updated to revision {successRev}
        </div>
      )}

      {/* Summary line + Update DB button */}
      {diffSummary && (
        <div className="mx-4 mt-4 flex items-center gap-4">
          {dbRevision !== null && (
            <span className="text-sm font-semibold text-gray-500 whitespace-nowrap">
              Rev. {dbRevision}
            </span>
          )}
          <div className="text-sm text-gray-600 flex gap-4">
            {diffSummary.added > 0 && (
              <span className="text-green-700 font-medium">+{diffSummary.added} added</span>
            )}
            {diffSummary.modified > 0 && (
              <span className="text-amber-700 font-medium">~{diffSummary.modified} modified</span>
            )}
            {diffSummary.unchanged > 0 && (
              <span>{diffSummary.unchanged} unchanged</span>
            )}
            {diffSummary.retired > 0 && (
              <span className="text-red-700 font-medium">-{diffSummary.retired} retired</span>
            )}
          </div>
          <button
            onClick={openModal}
            disabled={!hasChanges}
            title={isDirty ? 'Save or discard changes before updating the registry' : undefined}
            className={`ml-auto px-3 py-1 text-sm rounded font-medium transition-colors ${
              hasChanges
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            Update DB
          </button>
        </div>
      )}

      <RegistryTable rows={diffRows} />
      <ValidationPanel messages={messages} />

      {/* Apply confirmation modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title="Apply Registry Changes"
      >
        {diffSummary && (
          <p className="text-sm text-gray-700 mb-4">
            {[
              diffSummary.added > 0 && `${diffSummary.added} added`,
              diffSummary.modified > 0 && `${diffSummary.modified} modified`,
              diffSummary.retired > 0 && `${diffSummary.retired} retired`,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
        <label htmlFor="apply-comment" className="block text-sm font-medium text-gray-700 mb-1">
          Comment
        </label>
        <input
          id="apply-comment"
          type="text"
          value={applyComment}
          onChange={e => setApplyComment(e.target.value)}
          placeholder="Describe this registry update..."
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {applyError && (
          <p className="mt-2 text-sm text-red-600">{applyError}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={closeModal}
            className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmApply}
            disabled={applying || applyComment.trim() === ''}
            className={`px-4 py-2 text-sm rounded font-medium transition-colors ${
              applying || applyComment.trim() === ''
                ? 'bg-blue-300 text-white cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {applying ? 'Applying…' : 'Confirm'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

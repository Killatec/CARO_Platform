import React, { useEffect, useState, useRef } from 'react';
import { RegistryTable } from '../components/registry/RegistryTable.jsx';
import { ValidationPanel } from '../components/shared/ValidationPanel.jsx';
import { Modal } from '@caro/ui/primitives';
import { useTemplateGraphStore } from '../stores/useTemplateGraphStore.js';
import { useRegistryStore } from '../stores/useRegistryStore.js';
import { useUIStore } from '../stores/useUIStore.js';
import { useTagTypesStore } from '../stores/useTagTypesStore.js';
import { useModuleTypesStore } from '../stores/useModuleTypesStore.js';
import { useValidation } from '../hooks/useValidation.js';
import { resolveRegistry } from '@caro/tag-registry-shared';
import { fetchRegistry, applyRegistry } from '../api/registry.js';
import { downloadTagDefs } from '../api/tagDefs.js';
import { diffRegistry } from '../utils/diffRegistry.js';
import type { DiffRow } from '../utils/diffRegistry.js';
import { resolveDisplayRows, sortRegistryRows } from '../utils/registryRows.js';
import { buildRegistryCsv } from '../utils/exportRegistryCsv.js';
import type { ActiveTag } from '@caro/db';

type DiffSummary = Record<string, number>;

/**
 * RegistryPage - displays resolved tag registry with optional diff against DB
 */
export function RegistryPage(): React.ReactElement {
  const templateMap = useTemplateGraphStore(state => state.templateMap);
  const rootTemplateName = useTemplateGraphStore(state => state.rootTemplateName);
  const isDirty = useTemplateGraphStore(state => state.dirtySet.size > 0 || state.pendingDeletions.size > 0);
  const tags = useRegistryStore(state => state.tags);
  const setTags = useRegistryStore(state => state.setTags);
  const sortField = useRegistryStore(state => state.sortField);
  const sortDirection = useRegistryStore(state => state.sortDirection);
  const databaseName = useUIStore(state => state.validationConfig.databaseName);
  const projectRoot = useUIStore(state => state.validationConfig.projectRoot);
  const dataTypeLabels = useTagTypesStore(state => state.displayNameMap);
  const moduleTypeLabels = useModuleTypesStore(state => state.displayNameMap);

  const { messages, isValid } = useValidation(templateMap, rootTemplateName);

  const [diffRows, setDiffRows] = useState<DiffRow[] | null>(null);
  const [dbRevision, setDbRevision] = useState<number | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [applyComment, setApplyComment] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const [generatingTagDefs, setGeneratingTagDefs] = useState(false);
  const [tagDefsError, setTagDefsError] = useState<string | null>(null);

  const [successRev, setSuccessRev] = useState<number | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      .then((dbTags: ActiveTag[]) => {
        setDiffRows(diffRegistry(proposed, dbTags));
        const rev = dbTags.length > 0 ? Math.max(...dbTags.map(t => t.registry_rev)) : null;
        setDbRevision(rev);
      })
      .catch((err: Error) => {
        setDbError(err.message || 'Failed to load database registry');
        setDiffRows(null);
        setDbRevision(null);
      });
  }, [templateMap, rootTemplateName, isValid, setTags]);

  function refreshDiff() {
    if (!rootTemplateName || !templateMap || templateMap.size === 0 || !isValid) return;
    const proposed = resolveRegistry(templateMap, rootTemplateName);
    setTags(proposed);
    fetchRegistry()
      .then((dbTags: ActiveTag[]) => setDiffRows(diffRegistry(proposed, dbTags)))
      .catch((err: Error) => setDbError(err.message || 'Failed to load database registry'));
  }

  // PROJECT_ROOT unset/empty (null here) never matches — apply is refused
  // server-side in that state, so the button must never read as enabled.
  const rootMatchesProject = projectRoot !== null && (projectRoot === '*' || projectRoot === rootTemplateName);

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

  function handleExportCsv() {
    if (!rootTemplateName) return;
    const displayRows = sortRegistryRows(resolveDisplayRows(diffRows, tags), sortField, sortDirection);
    const csv = buildRegistryCsv(displayRows, dataTypeLabels, moduleTypeLabels);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rootTemplateName}_registry.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleGenerateTagDefs() {
    if (!rootTemplateName) return;
    setGeneratingTagDefs(true);
    setTagDefsError(null);
    try {
      await downloadTagDefs(rootTemplateName);
    } catch (err) {
      setTagDefsError((err as Error).message || 'Failed to generate Tag Defs');
    } finally {
      setGeneratingTagDefs(false);
    }
  }

  async function handleConfirmApply() {
    setApplying(true);
    setApplyError(null);
    try {
      const result = await applyRegistry(rootTemplateName!, applyComment);
      setModalOpen(false);
      setApplyComment('');
      setSuccessRev(result.registry_rev);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSuccessRev(null), 4000);
      setDbRevision(result.registry_rev);
      refreshDiff();
    } catch (err) {
      setApplyError((err as Error).message || 'Failed to apply registry');
    } finally {
      setApplying(false);
    }
  }

  // Quiet, always-visible orientation strip — shown regardless of root
  // selection or validation state, so it sits above the early-return bodies
  // below rather than inside any one of them.
  const connectionIndicator = (
    <div
      data-testid="db-connection-indicator"
      className="px-4 py-1 text-xs text-gray-400 border-b border-gray-100 flex items-center gap-3 flex-shrink-0"
    >
      <span>DB: <span className="text-gray-500">{databaseName || '—'}</span></span>
      <span aria-hidden="true">·</span>
      <span>PROJECT_ROOT: <span className="text-gray-500">{projectRoot ?? '(not configured)'}</span></span>
    </div>
  );

  let mainContent: React.ReactElement;

  if (!rootTemplateName) {
    mainContent = (
      <div className="flex flex-col h-full p-6 text-center text-gray-500">
        <p>Select a root template from the dropdown above to view the registry.</p>
      </div>
    );
  } else if (!isValid) {
    mainContent = (
      <div className="flex flex-col h-full p-6 text-center">
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
  } else {
    const diffSummary: DiffSummary | null = diffRows
      ? ['added', 'modified', 'unchanged', 'retired'].reduce<DiffSummary>((acc, s) => {
          acc[s] = diffRows.filter(r => r.diffStatus === s).length;
          return acc;
        }, {})
      : null;

    const hasChanges = !isDirty && rootMatchesProject && diffSummary
      ? diffSummary.added > 0 || diffSummary.modified > 0 || diffSummary.retired > 0
      : false;

    const updateDbTitle = isDirty
      ? 'Save or discard changes before updating the registry'
      : !rootMatchesProject
        ? (projectRoot
            ? `This server's PROJECT_ROOT is "${projectRoot}" — selected root "${rootTemplateName}" cannot be applied here.`
            : 'PROJECT_ROOT is not configured on this server — apply is disabled.')
        : undefined;

    mainContent = (
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0 overflow-auto">
          {dbError && (
            <div className="mx-4 mt-4 bg-amber-50 border border-amber-300 rounded p-3 text-sm text-amber-800">
              DB registry unavailable — showing proposed registry without diff. ({dbError})
            </div>
          )}

          {tagDefsError && (
            <div data-testid="tag-defs-error" className="mx-4 mt-4 bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
              Generate Tag Defs failed: {tagDefsError}
            </div>
          )}

          {successRev !== null && (
            <div className="mx-4 mt-4 bg-green-50 border border-green-300 rounded p-3 text-sm text-green-800">
              Registry updated to revision {successRev}
            </div>
          )}

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
                onClick={handleExportCsv}
                title="Export the current table as CSV"
                className="ml-auto px-3 py-1 text-sm rounded font-medium transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                Export to CSV
              </button>
              <button
                onClick={handleGenerateTagDefs}
                disabled={isDirty || generatingTagDefs}
                title={isDirty
                  ? 'Save or discard changes before generating Tag Defs — the export reads saved templates'
                  : 'Download a ZIP with one JSON per MQTT module template (tag_name, direction, data_type)'}
                className={`px-3 py-1 text-sm rounded font-medium transition-colors ${
                  isDirty || generatingTagDefs
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {generatingTagDefs ? 'Generating…' : 'Generate Tag Defs'}
              </button>
              <button
                onClick={openModal}
                disabled={!hasChanges}
                title={updateDbTitle}
                className={`px-3 py-1 text-sm rounded font-medium transition-colors ${
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
        </div>

        <div className="flex-shrink-0">
          <ValidationPanel messages={messages} />
        </div>

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

  return (
    <div className="flex flex-col h-full">
      {connectionIndicator}
      <div className="flex-1 min-h-0 overflow-hidden">
        {mainContent}
      </div>
    </div>
  );
}

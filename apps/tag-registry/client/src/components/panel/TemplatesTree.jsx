import React, { useEffect, useMemo, useState } from 'react';
import { listTemplates, loadRoot } from '../../api/templates.js';
import { useUIStore } from '../../stores/useUIStore.js';
import { useTemplateGraphStore } from '../../stores/useTemplateGraphStore.js';
import { NewTemplateModal } from '../shared/NewTemplateModal.jsx';
import { TrashIcon } from '../shared/TrashIcon.jsx';
import { deepNotEqual } from '../../../../shared/utils.js';

/**
 * TemplateLeaf - single template entry in TemplatesTree.
 * Extracted so useMemo can compute isDirty per leaf without violating
 * the rules of hooks (cannot call hooks inside .map()).
 */
function TemplateLeaf({ name, isSelected, injecting, originalTemplateMap, templateMap, onSelect, onDelete }) {
  const isDirty = useMemo(() => {
    if (!originalTemplateMap.has(name)) {
      // New template — created this session, never saved
      return templateMap.has(name);
    }
    const original = originalTemplateMap.get(name)?.template;
    const current  = templateMap.get(name)?.template;
    if (!current) return false;
    return deepNotEqual(original, current);
  }, [name, originalTemplateMap, templateMap]);

  return (
    <div
      className={`flex items-center pl-8 pr-2 py-1.5 cursor-pointer hover:bg-gray-100 whitespace-nowrap ${
        injecting && isSelected ? 'opacity-50' : ''
      } ${
        isSelected
          ? 'bg-blue-50 border-l-4 border-blue-600'
          : 'border-l-4 border-transparent'
      }`}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/plain', name);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onSelect(name)}
    >
      <span className={`flex-1 text-sm ${isDirty ? 'font-semibold text-orange-700' : isSelected ? 'font-normal text-blue-800' : 'font-normal text-gray-800'}`}>
        {name}
      </span>
      <button
        type="button"
        onClick={(e) => onDelete(name, e)}
        title={`Delete template "${name}"`}
        className="ml-1 p-1 text-gray-400 hover:text-red-500 transition-colors rounded"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

/**
 * TemplatesTree - shows all templates on disk grouped by template_type.
 * Folders start collapsed. Clicking a leaf fetches the full reachable
 * subgraph (via GET /templates/root/:name) and injects it into the store
 * before calling onTemplateSelect — this eliminates INVALID_REFERENCE
 * validation errors and sets the originalTemplateMap baseline at fetch time
 * so simulateCascade produces a real diff.
 * Clicking a folder header only toggles expand/collapse.
 */
export function TemplatesTree({ onTemplateSelect }) {
  const [grouped, setGrouped] = useState({});   // { [template_type]: string[] }
  const [expanded, setExpanded] = useState({});  // { [template_type]: boolean }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [injecting, setInjecting] = useState(false);
  const [newTemplateOpen, setNewTemplateOpen] = useState(false);

  const selectedTemplateTree    = useUIStore(state => state.selectedTemplateTree);
  const setSelectedTemplateTree = useUIStore(state => state.setSelectedTemplateTree);
  const dirtySet                = useTemplateGraphStore(state => state.dirtySet);
  const pendingDeletions        = useTemplateGraphStore(state => state.pendingDeletions);
  const templateMap             = useTemplateGraphStore(state => state.templateMap);
  const originalTemplateMap     = useTemplateGraphStore(state => state.originalTemplateMap);
  const hashes                  = useTemplateGraphStore(state => state.hashes);
  const injectTemplateGraph     = useTemplateGraphStore(state => state.injectTemplateGraph);
  const addTemplate             = useTemplateGraphStore(state => state.addTemplate);
  const removeTemplate          = useTemplateGraphStore(state => state.removeTemplate);
  const markForDeletion         = useTemplateGraphStore(state => state.markForDeletion);

  const fetchTemplates = () => {
    listTemplates()
      .then(templates => {
        const groups = {};
        for (const t of templates) {
          if (!groups[t.template_type]) groups[t.template_type] = [];
          groups[t.template_type].push(t.template_name);
        }
        for (const type of Object.keys(groups)) groups[type].sort();
        setGrouped(groups);

        // Preserve existing expanded state — only initialize new folders to
        // collapsed; prune entries for types that no longer exist.
        setExpanded(prev => {
          const next = { ...prev };
          for (const type of Object.keys(groups)) {
            if (!(type in next)) next[type] = false;
          }
          for (const type of Object.keys(next)) {
            if (!(type in groups)) delete next[type];
          }
          return next;
        });

        setLoading(false);
      })
      .catch(err => {
        setError(err.message || 'Failed to load templates');
        setLoading(false);
      });
  };

  // Fetch when dirtySet and pendingDeletions are both empty:
  // covers initial mount, post-save, and post-discard.
  // Gating on pendingDeletions prevents re-fetch while deletions are queued.
  useEffect(() => {
    if (dirtySet.size === 0 && pendingDeletions.size === 0) {
      fetchTemplates();
    }
  }, [dirtySet, pendingDeletions]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFolder = (type) => {
    setExpanded(prev => ({ ...prev, [type]: !prev[type] }));
  };

  const handleLeafClick = async (name) => {
    if (injecting) return;

    // If the template (and its subgraph) is not yet in the store, fetch and
    // inject the full reachable graph via the root endpoint. This populates
    // all descendant templates so the validator finds no missing references,
    // and sets the originalTemplateMap baseline so simulateCascade works.
    if (!templateMap.has(name)) {
      setInjecting(true);
      try {
        const data = await loadRoot(name);
        injectTemplateGraph(data.templates);
      } catch {
        // On error, onTemplateSelect still fires; FieldsPanel will show blank.
      } finally {
        setInjecting(false);
      }
    }

    onTemplateSelect(name);
  };

  const _removeFromGrouped = (name) => {
    setGrouped(prev => {
      const next = {};
      for (const [type, names] of Object.entries(prev)) {
        const filtered = names.filter(n => n !== name);
        if (filtered.length > 0) next[type] = filtered;
      }
      return next;
    });
  };

  const handleDeleteClick = async (name, e) => {
    e.stopPropagation();

    // A template is new (unsaved) only if it was created this session:
    // exists in templateMap with a null/undefined hash. Server-listed
    // templates are always treated as saved regardless of originalTemplateMap.
    const hash = hashes.get(name);
    const isNew = templateMap.has(name) && (hash === null || hash === undefined);

    if (isNew) {
      // New unsaved template — instant client-side removal, no server call.
      removeTemplate(name);
      _removeFromGrouped(name);
      if (selectedTemplateTree === name) setSelectedTemplateTree(null);
    } else {
      // Saved template — ensure hash is loaded before marking for deletion.
      // A template never clicked this session won't be in hashes yet; fetch
      // it now so markForDeletion can send the correct original_hash on Save.
      if (!hashes.has(name)) {
        try {
          const data = await loadRoot(name);
          injectTemplateGraph(data.templates);
        } catch {
          // Cannot safely delete without the hash — abort silently.
          return;
        }
      }
      markForDeletion(name);
      _removeFromGrouped(name);
      if (selectedTemplateTree === name) setSelectedTemplateTree(null);
    }
  };

  const handleNewTemplate = (name, type) => {
    const template = { template_name: name, template_type: type, fields: {}, children: [] };
    addTemplate(template, null);
    setGrouped(prev => {
      const next = { ...prev };
      next[type] = [...(next[type] || []), name].sort();
      return next;
    });
    setExpanded(prev => ({ ...prev, [type]: true }));
    setNewTemplateOpen(false);
    onTemplateSelect(name);
  };

  if (loading) {
    return (
      <div className="p-4 text-sm text-gray-500" data-testid="templates-tree">Loading templates...</div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-500" data-testid="templates-tree">{error}</div>
    );
  }

  const types = Object.keys(grouped).sort();

  return (
    <div className="select-none" data-testid="templates-tree">
      <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 flex items-center justify-between">
        All Templates
        <button
          onClick={() => setNewTemplateOpen(true)}
          className="text-xs font-semibold text-white bg-gray-500 hover:bg-gray-600 px-2 py-0.5 rounded"
        >
          New
        </button>
      </div>

      {types.map(type => {
        const names = grouped[type];
        const isExpanded = expanded[type];

        return (
          <div key={type}>
            {/* Folder header — toggles only, never selects */}
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-100 whitespace-nowrap"
              onClick={() => toggleFolder(type)}
            >
              <button
                onClick={(e) => { e.stopPropagation(); toggleFolder(type); }}
                className="w-4 h-4 flex items-center justify-center hover:bg-gray-200 rounded text-xs text-gray-500"
              >
                {isExpanded ? '▼' : '▶'}
              </button>
              <span className="flex-1 text-sm font-medium text-gray-700">{type}</span>
              <span className="text-xs text-gray-400">{names.length}</span>
            </div>

            {/* Template leaves */}
            {isExpanded && names.map(name => (
              <TemplateLeaf
                key={name}
                name={name}
                isSelected={selectedTemplateTree === name}
                injecting={injecting}
                originalTemplateMap={originalTemplateMap}
                templateMap={templateMap}
                onSelect={handleLeafClick}
                onDelete={handleDeleteClick}
              />
            ))}
          </div>
        );
      })}

      {types.length === 0 && (
        <div className="p-4 text-sm text-gray-500">No templates found.</div>
      )}

      <NewTemplateModal
        isOpen={newTemplateOpen}
        onConfirm={handleNewTemplate}
        onCancel={() => setNewTemplateOpen(false)}
        existingTypes={types}
        existingNames={Object.values(grouped).flat()}
      />
    </div>
  );
}

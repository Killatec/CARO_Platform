import React, { useEffect, useMemo, useState } from 'react';
import { listTemplates, loadRoot } from '../../api/templates.js';
import { useUIStore } from '../../stores/useUIStore.js';
import { useTemplateGraphStore } from '../../stores/useTemplateGraphStore.js';
import { NewTemplateModal } from '../shared/NewTemplateModal.jsx';
import { TrashIcon } from '../shared/TrashIcon.jsx';
import { deepNotEqual, IN_TAG_NAME_FIELD } from '@caro/tag-registry-shared';
import type { TemplateEntry } from '@caro/tag-registry-shared';
import { setActiveDragData, clearActiveDragData } from '../../utils/dragTypes.js';

interface TemplateLeafProps {
  name: string;
  isSelected: boolean;
  injecting: boolean;
  originalTemplateMap: Map<string, TemplateEntry>;
  templateMap: Map<string, TemplateEntry>;
  onSelect: (name: string) => void;
  onDelete: (name: string, e: React.MouseEvent) => void;
}

function TemplateLeaf({
  name, isSelected, injecting, originalTemplateMap, templateMap, onSelect, onDelete
}: TemplateLeafProps): React.ReactElement {
  const isDirty = useMemo(() => {
    if (!originalTemplateMap.has(name)) {
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
        const data = { source: 'template-panel' as const, templateName: name };
        e.dataTransfer.setData('application/json', JSON.stringify(data));
        e.dataTransfer.setData('text/plain', name);
        e.dataTransfer.effectAllowed = 'copy';
        setActiveDragData(data);
      }}
      onDragEnd={() => clearActiveDragData()}
      onClick={() => onSelect(name)}
    >
      <span className={`flex-1 text-sm ${isDirty ? 'font-semibold italic text-gray-800' : isSelected ? 'font-normal text-blue-800' : 'font-normal text-gray-800'}`}>
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

const LS_KEY = 'caro_templates_expanded';

function lsGet(): Record<string, boolean> | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) as Record<string, boolean> : null;
  } catch {
    return null;
  }
}

function lsSet(state: Record<string, boolean>): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

interface TemplatesTreeProps {
  onTemplateSelect: (name: string) => void;
}

/**
 * TemplatesTree - shows all templates on disk grouped by template_type.
 */
export function TemplatesTree({ onTemplateSelect }: TemplatesTreeProps): React.ReactElement {
  const [grouped, setGrouped] = useState<Record<string, string[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => lsGet() ?? {});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        const groups: Record<string, string[]> = {};
        for (const t of templates) {
          if (!groups[t.template_type]) groups[t.template_type] = [];
          groups[t.template_type].push(t.template_name);
        }
        for (const type of Object.keys(groups)) groups[type].sort();
        setGrouped(groups);

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
      .catch((err: Error) => {
        setError(err.message || 'Failed to load templates');
        setLoading(false);
      });
  };

  useEffect(() => {
    lsSet(expanded);
  }, [expanded]);

  useEffect(() => {
    if (dirtySet.size === 0 && pendingDeletions.size === 0) {
      fetchTemplates();
    }
  }, [dirtySet, pendingDeletions]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFolder = (type: string) => {
    setExpanded(prev => ({ ...prev, [type]: !prev[type] }));
  };

  const handleLeafClick = async (name: string) => {
    if (injecting) return;

    if (!templateMap.has(name)) {
      setInjecting(true);
      try {
        const data = await loadRoot(name);
        if (data) injectTemplateGraph(data.templates);
      } catch {
        // On error, onTemplateSelect still fires; FieldsPanel will show blank.
      } finally {
        setInjecting(false);
      }
    }

    onTemplateSelect(name);
  };

  const _removeFromGrouped = (name: string) => {
    setGrouped(prev => {
      const next: Record<string, string[]> = {};
      for (const [type, names] of Object.entries(prev)) {
        const filtered = names.filter(n => n !== name);
        if (filtered.length > 0) next[type] = filtered;
      }
      return next;
    });
  };

  const handleDeleteClick = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const hash = hashes.get(name);
    const isNew = templateMap.has(name) && (hash === null || hash === undefined);

    if (isNew) {
      removeTemplate(name);
      _removeFromGrouped(name);
      if (selectedTemplateTree === name) setSelectedTemplateTree(null);
    } else {
      if (!hashes.has(name)) {
        try {
          const data = await loadRoot(name);
          if (data) injectTemplateGraph(data.templates);
        } catch {
          return;
        }
      }
      markForDeletion(name);
      _removeFromGrouped(name);
      if (selectedTemplateTree === name) setSelectedTemplateTree(null);
    }
  };

  const handleNewTemplate = (name: string, type: string) => {
    const inTagNameDefault = type === 'parameter' || type === 'tag';
    const template = {
      template_name: name,
      template_type: type,
      fields: { [IN_TAG_NAME_FIELD]: { field_type: 'Boolean' as const, default: inTagNameDefault } },
      children: [],
    };
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
        Templates
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

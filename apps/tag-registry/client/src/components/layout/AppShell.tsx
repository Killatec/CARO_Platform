import React, { useEffect, useState } from 'react';
import { Button, Dropdown } from '@caro/ui/primitives';
import { Sidebar } from './Sidebar.jsx';
import { useRootTemplate } from '../../hooks/useRootTemplate.js';
import { useTemplateGraphStore } from '../../stores/useTemplateGraphStore.js';
import { useUIStore } from '../../stores/useUIStore.js';
import { simulateCascade } from '@caro/tag-registry-shared';
import * as templatesApi from '../../api/templates.js';
import { fetchConfig } from '../../api/config.js';
import { fetchTagTypes } from '../../api/tagTypes.js';
import { useTagTypesStore } from '../../stores/useTagTypesStore.js';
import { fetchModuleTypes } from '../../api/moduleTypes.js';
import { useModuleTypesStore } from '../../stores/useModuleTypesStore.js';
import type { TemplateListItem } from '../../api/templates.js';

interface ChildChanged {
  template_name: string;
  added: Array<{ asset_name: string; template_name: string }>;
  removed: Array<{ asset_name: string; template_name: string }>;
}

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * AppShell - main layout container
 */
export function AppShell({ children }: AppShellProps): React.ReactElement {
  const selectedRoot    = useRootTemplate(state => state.selectedRoot);
  const setSelectedRoot = useRootTemplate(state => state.setSelectedRoot);

  const templateMap         = useTemplateGraphStore(state => state.templateMap);
  const originalTemplateMap = useTemplateGraphStore(state => state.originalTemplateMap);
  const dirtySet            = useTemplateGraphStore(state => state.dirtySet);
  const pendingDeletions    = useTemplateGraphStore(state => state.pendingDeletions);
  const isDirty             = useTemplateGraphStore(state => state.dirtySet.size > 0 || state.pendingDeletions.size > 0);
  const isValid             = useTemplateGraphStore(state => state.validationState.isValid);
  const save                = useTemplateGraphStore(state => state.save);
  const discard             = useTemplateGraphStore(state => state.discard);

  const openModal             = useUIStore(state => state.openModal);
  const setPendingBatch       = useUIStore(state => state.setPendingBatch);
  const activeTab             = useUIStore(state => state.activeTab);
  const setValidationConfig   = useUIStore(state => state.setValidationConfig);

  const [templates, setTemplates] = useState<TemplateListItem[]>([]);

  useEffect(() => {
    async function loadTemplates() {
      try {
        const allTemplates = await templatesApi.listTemplates();
        setTemplates(allTemplates);

        const lastRoot = localStorage.getItem('caro_last_root');
        if (lastRoot && allTemplates.some(t => t.template_name === lastRoot)) {
          setSelectedRoot(lastRoot);
        }
      } catch (error) {
        console.error('Failed to load templates:', error);
      }
    }
    loadTemplates();
  }, []);

  useEffect(() => {
    async function loadConfig() {
      try {
        const config = await fetchConfig();
        setValidationConfig(config);
      } catch (error) {
        console.error('Failed to load validation config:', error);
      }
    }
    loadConfig();
  }, []);

  useEffect(() => {
    fetchTagTypes()
      .then(types => useTagTypesStore.getState().setTagTypes(types))
      .catch(error => console.error('Failed to load tag types:', error));
  }, []);

  useEffect(() => {
    fetchModuleTypes()
      .then(types => useModuleTypesStore.getState().setModuleTypes(types))
      .catch(error => console.error('Failed to load module types:', error));
  }, []);

  const rootOptions = templates
    .filter(t => t.template_type !== 'tag')
    .map(t => ({
      value: t.template_name,
      label: `${t.template_name} (${t.template_type})`
    }));

  const _buildDiffEnrichment = () => {
    const newTemplates = Array.from(dirtySet)
      .filter(name => !originalTemplateMap.has(name))
      .map(name => ({
        template_name: name,
        template_type: templateMap.get(name)?.template?.template_type ?? 'unknown'
      }));

    const pendingDeletionsList = Array.from(pendingDeletions)
      .map(name => ({
        template_name: name,
        template_type: originalTemplateMap.get(name)?.template?.template_type ?? 'unknown'
      }));

    const childrenChanged: ChildChanged[] = [];
    for (const name of dirtySet) {
      const current = templateMap.get(name)?.template;
      const original = originalTemplateMap.get(name)?.template;
      if (!current || !original) continue;

      const currentChildren = current.children ?? [];
      const originalChildren = original.children ?? [];

      const added = currentChildren.filter(
        c => !originalChildren.some(o => o.asset_name === c.asset_name)
      );
      const removed = originalChildren.filter(
        o => !currentChildren.some(c => c.asset_name === o.asset_name)
      );

      if (added.length > 0 || removed.length > 0) {
        childrenChanged.push({
          template_name: name,
          added: added.map(c => ({ asset_name: c.asset_name, template_name: c.template_name })),
          removed: removed.map(c => ({ asset_name: c.asset_name, template_name: c.template_name })),
        });
      }
    }

    return {
      new_templates: newTemplates,
      pending_deletions: pendingDeletionsList,
      children_changed: childrenChanged,
    };
  };

  const handleSave = () => {
    save((result, batch) => {
      openModal('cascadeConfirm', { ...result, ..._buildDiffEnrichment() } as Record<string, unknown>);
      setPendingBatch(batch);
    });
  };

  const handleSeeChanges = () => {
    const changes = Array.from(dirtySet).map(name => ({
      template_name: name,
      template: templateMap.get(name)!.template,
    }));
    const result = simulateCascade(originalTemplateMap, changes);
    openModal('cascadePreview', { ...result, ..._buildDiffEnrichment() } as Record<string, unknown>);
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-gray-800 text-white px-6 py-3 flex items-center gap-6 shadow-lg">
        <h1 className="text-xl font-bold flex-shrink-0">Tag Registry</h1>

        <div className="flex items-center gap-2 flex-shrink-0">
          <label className="text-sm">Root Template:</label>
          {isDirty ? (
            <div title="Save or discard changes before switching root" className="cursor-not-allowed">
              <Dropdown
                options={rootOptions}
                value={selectedRoot || ''}
                onChange={(e) => setSelectedRoot((e.target as HTMLSelectElement).value)}
                placeholder="Select root..."
                className="w-64"
                disabled={true}
              />
            </div>
          ) : (
            <Dropdown
              options={rootOptions}
              value={selectedRoot || ''}
              onChange={(e) => setSelectedRoot((e.target as HTMLSelectElement).value)}
              placeholder="Select root..."
              className="w-64"
            />
          )}
        </div>

        {activeTab === 'editor' && isDirty && (
          <div className="flex items-center gap-2" data-testid="save-bar">
            <Button variant="primary" disabled={!isValid} onClick={handleSave} data-testid="save-button">
              Save
            </Button>
            <Button variant="secondary" onClick={handleSeeChanges} data-testid="see-changes-button">
              See what&apos;s changed
            </Button>
            <Button variant="secondary" onClick={() => discard()} data-testid="cancel-button">
              Cancel
            </Button>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden bg-gray-50">
          {children}
        </main>
      </div>
    </div>
  );
}

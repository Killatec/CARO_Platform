import type {
  Template, TemplateEntry, ProposedChange,
  CascadeResult, CascadeDiff, FieldDiff, FieldChanged,
  InstanceFieldChanged, AffectedParent, DroppedInstanceValue,
} from './types.js';
import { extractTemplate } from './types.js';

type TemplateMapInput =
  | Map<string, Template | TemplateEntry>
  | Record<string, Template | TemplateEntry>
  | null
  | undefined;

export function simulateCascade(
  currentTemplateMap: TemplateMapInput,
  proposedChanges: ProposedChange[] | null | undefined,
): CascadeResult {
  const empty: CascadeResult = {
    requiresConfirmation: false,
    diff: { fields_added: [], fields_removed: [], fields_changed: [], instance_fields_changed: [], template_type_changed: [] },
    affectedParents: [],
  };

  if (!currentTemplateMap || !proposedChanges || proposedChanges.length === 0) {
    return empty;
  }

  let workingMap: Map<string, Template | TemplateEntry>;
  if (currentTemplateMap instanceof Map) {
    workingMap = new Map(currentTemplateMap);
  } else {
    workingMap = new Map(Object.entries(currentTemplateMap));
  }

  const currentTemplates = new Map<string, Template>();
  for (const [name, value] of workingMap.entries()) {
    if (value && typeof value === 'object') {
      currentTemplates.set(name, extractTemplate(value));
    }
  }

  const allFieldsAdded: FieldDiff[] = [];
  const allFieldsRemoved: FieldDiff[] = [];
  const allFieldsChanged: FieldChanged[] = [];

  for (const change of proposedChanges) {
    const currentTemplate = currentTemplates.get(change.template_name);
    const proposedTemplate = change.template;
    if (!currentTemplate || !proposedTemplate) continue;

    const currentFields = new Set(Object.keys(currentTemplate.fields || {}));
    const proposedFields = new Set(Object.keys(proposedTemplate.fields || {}));

    for (const field of proposedFields) {
      if (!currentFields.has(field)) {
        allFieldsAdded.push({ template_name: change.template_name, field });
      }
    }

    for (const field of currentFields) {
      if (!proposedFields.has(field)) {
        allFieldsRemoved.push({ template_name: change.template_name, field });
      }
    }

    for (const field of currentFields) {
      if (proposedFields.has(field)) {
        const currentDef = currentTemplate.fields[field];
        const proposedDef = proposedTemplate.fields[field];
        if (JSON.stringify(currentDef) !== JSON.stringify(proposedDef)) {
          allFieldsChanged.push({
            template_name: change.template_name,
            field,
            old_value: currentDef?.default ?? currentDef,
            new_value: proposedDef?.default ?? proposedDef,
          });
        }
      }
    }
  }

  const allInstanceFieldsChanged: InstanceFieldChanged[] = [];

  for (const change of proposedChanges) {
    const currentTemplate = currentTemplates.get(change.template_name);
    const proposedTemplate = change.template;
    if (!currentTemplate || !proposedTemplate) continue;

    const currentChildren = currentTemplate.children || [];
    const proposedChildren = proposedTemplate.children || [];

    const proposedChildByAssetName = new Map(
      proposedChildren.filter(c => c.asset_name).map(c => [c.asset_name, c]),
    );

    for (let i = 0; i < currentChildren.length; i++) {
      const currentChild = currentChildren[i];
      if (!currentChild.asset_name) continue;

      const proposedChild =
        proposedChildByAssetName.get(currentChild.asset_name) ?? proposedChildren[i];
      if (!proposedChild) continue;

      const currentChildFields = currentChild.fields as Record<string, unknown> || {};
      const proposedChildFields = proposedChild.fields as Record<string, unknown> || {};

      const allChildFieldNames = new Set([
        ...Object.keys(currentChildFields),
        ...Object.keys(proposedChildFields),
      ]);

      for (const fieldName of allChildFieldNames) {
        const hasOld = Object.prototype.hasOwnProperty.call(currentChildFields, fieldName);
        const hasNew = Object.prototype.hasOwnProperty.call(proposedChildFields, fieldName);

        if (hasOld && hasNew) {
          if (JSON.stringify(currentChildFields[fieldName]) !== JSON.stringify(proposedChildFields[fieldName])) {
            allInstanceFieldsChanged.push({
              template_name: change.template_name,
              asset_name: currentChild.asset_name,
              field: fieldName,
              old_value: currentChildFields[fieldName],
              new_value: proposedChildFields[fieldName],
            });
          }
        } else if (!hasOld && hasNew) {
          allInstanceFieldsChanged.push({
            template_name: change.template_name,
            asset_name: currentChild.asset_name,
            field: fieldName,
            old_value: undefined,
            new_value: proposedChildFields[fieldName],
          });
        } else if (hasOld && !hasNew) {
          allInstanceFieldsChanged.push({
            template_name: change.template_name,
            asset_name: currentChild.asset_name,
            field: fieldName,
            old_value: currentChildFields[fieldName],
            new_value: undefined,
          });
        }
      }
    }

    const currentAssetNames = currentChildren.map(c => c.asset_name);
    const proposedAssetNames = proposedChildren.map(c => c.asset_name);

    const currentAssetNameSet = new Set(currentAssetNames.filter(Boolean));
    const proposedAssetNameSet = new Set(proposedAssetNames.filter(Boolean));

    const removedAssetNames = currentAssetNames.filter(n => n && !proposedAssetNameSet.has(n)) as string[];
    const addedAssetNames = proposedAssetNames.filter(n => n && !currentAssetNameSet.has(n)) as string[];

    const pairCount = Math.min(removedAssetNames.length, addedAssetNames.length);
    for (let i = 0; i < pairCount; i++) {
      allInstanceFieldsChanged.push({
        template_name: change.template_name,
        asset_name: removedAssetNames[i],
        field: 'asset_name',
        old_value: removedAssetNames[i],
        new_value: addedAssetNames[i],
      });
    }
    for (let i = pairCount; i < removedAssetNames.length; i++) {
      allInstanceFieldsChanged.push({
        template_name: change.template_name,
        asset_name: removedAssetNames[i],
        field: 'asset_name',
        old_value: removedAssetNames[i],
        new_value: undefined,
      });
    }
    for (let i = pairCount; i < addedAssetNames.length; i++) {
      allInstanceFieldsChanged.push({
        template_name: change.template_name,
        asset_name: addedAssetNames[i],
        field: 'asset_name',
        old_value: undefined,
        new_value: addedAssetNames[i],
      });
    }
  }

  const templateTypeChanges: Array<{ template_name: string; old_value: string; new_value: string }> = [];

  for (const change of proposedChanges) {
    const currentTemplate = currentTemplates.get(change.template_name);
    const proposedTemplate = change.template;
    if (!currentTemplate || !proposedTemplate) continue;

    if (currentTemplate.template_type !== proposedTemplate.template_type) {
      templateTypeChanges.push({
        template_name: change.template_name,
        old_value: currentTemplate.template_type,
        new_value: proposedTemplate.template_type,
      });
    }
  }

  const schemaChangedNames = new Set([
    ...allFieldsAdded.map(f => f.template_name),
    ...allFieldsRemoved.map(f => f.template_name),
    ...allFieldsChanged.map(f => f.template_name),
  ]);

  const affectedParents: AffectedParent[] = [];

  for (const [parentName, parentTemplate] of currentTemplates.entries()) {
    if (!parentTemplate.children || !Array.isArray(parentTemplate.children)) continue;

    for (const child of parentTemplate.children) {
      if (child.template_name === parentName) continue;
      if (!schemaChangedNames.has(child.template_name)) continue;

      const droppedInstanceValues: DroppedInstanceValue[] = [];

      const change = proposedChanges.find(c => c.template_name === child.template_name);
      if (change && change.template) {
        const newChildFields = new Set(Object.keys(change.template.fields || {}));

        if (child.fields && typeof child.fields === 'object') {
          for (const [fieldName, fieldValue] of Object.entries(child.fields)) {
            if (!newChildFields.has(fieldName)) {
              droppedInstanceValues.push({
                field: fieldName,
                asset_name: child.asset_name,
                value: fieldValue,
              });
            }
          }
        }
      }

      affectedParents.push({
        parent_template_name: parentName,
        asset_name: child.asset_name,
        dropped_instance_values: droppedInstanceValues,
      });
    }
  }

  const requiresConfirmation = affectedParents.length > 0;

  const diff: CascadeDiff = {
    fields_added: allFieldsAdded,
    fields_removed: allFieldsRemoved,
    fields_changed: allFieldsChanged,
    instance_fields_changed: allInstanceFieldsChanged,
    template_type_changed: templateTypeChanges,
  };

  return { requiresConfirmation, diff, affectedParents };
}

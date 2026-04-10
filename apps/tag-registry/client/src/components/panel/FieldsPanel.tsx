import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Input } from '@caro/ui/primitives';
import { useUIStore } from '../../stores/useUIStore.js';
import { useTemplateGraphStore } from '../../stores/useTemplateGraphStore.js';
import { useTagTypesStore } from '../../stores/useTagTypesStore.js';
import { AddFieldModal } from '../shared/AddFieldModal.jsx';
import { TrashIcon } from '../shared/TrashIcon.jsx';
import { deepNotEqual } from '@caro/tag-registry-shared';
import type { FieldDef } from '@caro/tag-registry-shared';

type FieldType = 'Numeric' | 'String' | 'Boolean' | 'TagType';

function coerceValue(rawValue: unknown, fieldType: FieldType): number | string | boolean {
  if (fieldType === 'Boolean') return Boolean(rawValue);
  if (fieldType === 'Numeric') {
    const parsed = parseFloat(String(rawValue));
    return isNaN(parsed) ? 0 : parsed;
  }
  return String(rawValue); // String and TagType
}

interface FieldTableRowProps {
  fieldName: string;
  value: unknown;
  fieldType?: FieldType;
  isOverride?: boolean;
  isDirtyField?: boolean;
  readOnly?: boolean;
  onChange?: (value: unknown) => void;
  onDelete?: () => void;
}

function FieldTableRow({
  fieldName, value, fieldType = 'String', isOverride = false,
  isDirtyField = false, readOnly = false, onChange, onDelete
}: FieldTableRowProps): React.ReactElement {
  const tagTypes = useTagTypesStore(state => state.tagTypes);
  const colorClass = isDirtyField
    ? 'text-orange-700 font-semibold'
    : isOverride
      ? 'text-blue-600 font-normal'
      : 'text-gray-700 font-normal';
  const nameCellClass = `py-1.5 pr-4 text-sm whitespace-nowrap pl-2 ${colorClass}`;

  if (fieldType === 'TagType') {
    return (
      <tr>
        <td className={nameCellClass}>{fieldName}</td>
        <td className="py-1.5">
          <select
            value={value != null ? String(value) : ''}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            disabled={readOnly}
            className={`w-[20ch] text-sm border border-gray-300 rounded px-1 py-0.5 ${colorClass}`}
          >
            {tagTypes.map(t => (
              <option key={t.type_name} value={t.type_name}>{t.display_name}</option>
            ))}
          </select>
        </td>
        <td className="py-1.5 pl-1 w-6">
          {onDelete && (
            <button type="button" onClick={onDelete} title={`Delete field "${fieldName}"`}
              className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded">
              <TrashIcon />
            </button>
          )}
        </td>
      </tr>
    );
  }

  if (fieldType === 'Boolean') {
    return (
      <tr>
        <td className={nameCellClass}>{fieldName}</td>
        <td className="py-1.5 pl-2">
          <input
            type="checkbox"
            checked={!!value}
            onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
            disabled={readOnly}
            className={isDirtyField ? 'accent-orange-600' : isOverride ? 'accent-blue-600' : ''}
          />
        </td>
        <td className="py-1.5 pl-1 w-6">
          {onDelete && (
            <button type="button" onClick={onDelete} title={`Delete field "${fieldName}"`}
              className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded">
              <TrashIcon />
            </button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className={nameCellClass}>{fieldName}</td>
      <td className="py-1.5">
        <Input
          type={fieldType === 'Numeric' ? 'number' : 'text'}
          value={value != null ? String(value) : ''}
          onChange={onChange ? (e) => onChange((e.target as HTMLInputElement)?.value ?? e) : undefined}
          disabled={readOnly}
          className={`w-[20ch] text-sm ${colorClass}`}
        />
      </td>
      <td className="py-1.5 pl-1 w-6">
        {onDelete && (
          <button type="button" onClick={onDelete} title={`Delete field "${fieldName}"`}
            className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded">
            <TrashIcon />
          </button>
        )}
      </td>
    </tr>
  );
}

interface PropertiesHeaderProps {
  onAdd?: () => void;
}

function PropertiesHeader({ onAdd }: PropertiesHeaderProps): React.ReactElement {
  return (
    <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 flex items-center justify-between">
      Properties
      {onAdd && (
        <button
          onClick={onAdd}
          className="text-xs font-semibold text-white bg-gray-500 hover:bg-gray-600 px-2 py-0.5 rounded"
        >
          New
        </button>
      )}
    </div>
  );
}

/**
 * FieldsPanel - editable fields for whatever is currently selected.
 */
export function FieldsPanel(): React.ReactElement {
  const selectedTemplateTree                 = useUIStore(state => state.selectedTemplateTree);
  const selectedSystemTreeNode               = useUIStore(state => state.selectedSystemTreeNode);
  const selectedSystemTreeNodeParentPath     = useUIStore(state => state.selectedSystemTreeNodeParentPath);
  const selectedSystemTreeNodeParentTemplate = useUIStore(state => state.selectedSystemTreeNodeParentTemplate);
  const selectedSystemTreeNodeChildIndex     = useUIStore(state => state.selectedSystemTreeNodeChildIndex);
  const templateMap         = useTemplateGraphStore(state => state.templateMap);
  const originalTemplateMap = useTemplateGraphStore(state => state.originalTemplateMap);
  const updateTemplate      = useTemplateGraphStore(state => state.updateTemplate);

  const [addFieldOpen, setAddFieldOpen] = useState(false);

  const selectionKey =
    selectedTemplateTree   ? `t:${selectedTemplateTree}`   :
    selectedSystemTreeNode ? `s:${selectedSystemTreeNode}` :
    'blank';

  const [visible, setVisible] = useState(false);
  const prevKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectionKey === 'blank') {
      setVisible(false);
      prevKeyRef.current = selectionKey;
      return;
    }
    setVisible(false);
    const timer = setTimeout(() => setVisible(true), 0);
    prevKeyRef.current = selectionKey;
    return () => clearTimeout(timer);
  }, [selectionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodeData = useMemo(() => {
    if (!selectedSystemTreeNode || !templateMap) return null;

    if (!selectedSystemTreeNodeParentPath) {
      const entry = templateMap.get(selectedSystemTreeNode);
      if (!entry) return null;
      return {
        resolvedTemplateName: selectedSystemTreeNode,
        instanceOverrides: {} as Record<string, unknown>,
        assetName: selectedSystemTreeNode,
        isRoot: true,
      };
    }

    const parentEntry = templateMap.get(selectedSystemTreeNodeParentTemplate!);
    if (!parentEntry || selectedSystemTreeNodeChildIndex == null || selectedSystemTreeNodeChildIndex < 0) return null;

    const child = parentEntry.template.children?.[selectedSystemTreeNodeChildIndex];
    if (!child) return null;

    return {
      resolvedTemplateName: child.template_name,
      instanceOverrides: (child.fields || {}) as Record<string, unknown>,
      assetName: child.asset_name,
      isRoot: false,
    };
  }, [selectedSystemTreeNode, selectedSystemTreeNodeParentPath, selectedSystemTreeNodeParentTemplate, selectedSystemTreeNodeChildIndex, templateMap]);

  if (selectionKey === 'blank' || !visible) {
    return <div data-testid="fields-panel"><PropertiesHeader /></div>;
  }

  if (selectedTemplateTree) {
    const entry = templateMap.get(selectedTemplateTree);
    if (!entry) return <div data-testid="fields-panel"><PropertiesHeader /></div>;
    const { template } = entry;
    const fields = (template.fields || {}) as Record<string, FieldDef>;
    const existingFieldNames = Object.keys(fields);
    const originalFields = (originalTemplateMap.get(selectedTemplateTree)?.template?.fields ?? {}) as Record<string, FieldDef>;

    const handleFieldChange = (fieldName: string, rawValue: unknown) => {
      const fieldDef = fields[fieldName];
      const coerced = coerceValue(rawValue, fieldDef.field_type as FieldType);
      updateTemplate(template.template_name, {
        fields: { ...fields, [fieldName]: { ...fieldDef, default: coerced } },
      });
    };

    const handleDeleteField = (fieldName: string) => {
      const updatedFields = { ...fields };
      delete updatedFields[fieldName];
      updateTemplate(template.template_name, { fields: updatedFields });
    };

    const handleAddField = (fieldName: string, fieldType: FieldType, defaultValue: number | string | boolean) => {
      updateTemplate(template.template_name, {
        fields: { ...fields, [fieldName]: { field_type: fieldType, default: defaultValue } },
      });
      setAddFieldOpen(false);
    };

    return (
      <div data-testid="fields-panel">
        <PropertiesHeader onAdd={() => setAddFieldOpen(true)} />
        <table className="w-full border-collapse">
          <tbody>
            <FieldTableRow fieldName="Template Name" value={template.template_name} readOnly />
            <FieldTableRow fieldName="Template Type" value={template.template_type} readOnly />
            {Object.entries(fields).map(([key, fieldDef]) => {
              const isDirtyField = !(key in originalFields) ||
                originalFields[key]?.default !== fieldDef.default;
              return (
                <FieldTableRow
                  key={key}
                  fieldName={key}
                  value={fieldDef.default}
                  fieldType={fieldDef.field_type as FieldType}
                  isOverride={false}
                  isDirtyField={isDirtyField}
                  onChange={(value) => handleFieldChange(key, value)}
                  onDelete={() => handleDeleteField(key)}
                />
              );
            })}
            {Object.keys(fields).length === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-3 text-sm text-gray-500">
                  No fields defined.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <AddFieldModal
          isOpen={addFieldOpen}
          onConfirm={handleAddField}
          onCancel={() => setAddFieldOpen(false)}
          existingFieldNames={existingFieldNames}
        />
      </div>
    );
  }

  if (selectedSystemTreeNode && nodeData) {
    const templateEntry = templateMap.get(nodeData.resolvedTemplateName);
    if (!templateEntry) return <div data-testid="fields-panel"><PropertiesHeader /></div>;

    const { template } = templateEntry;
    const { instanceOverrides, assetName, isRoot } = nodeData;
    const defaultFields = (template.fields || {}) as Record<string, FieldDef>;

    const allKeys = [
      ...Object.keys(defaultFields),
      ...Object.keys(instanceOverrides).filter(k => !(k in defaultFields)),
    ];

    const originalParent = originalTemplateMap.get(selectedSystemTreeNodeParentTemplate!)?.template;
    const originalChild = originalParent?.children?.[selectedSystemTreeNodeChildIndex!];
    const originalOverrides = (originalChild?.fields ?? {}) as Record<string, unknown>;

    const isDirtyField = (fieldName: string): boolean => {
      const currentValue = instanceOverrides[fieldName];
      if (!(fieldName in originalOverrides)) return currentValue !== undefined;
      return deepNotEqual(currentValue, originalOverrides[fieldName]);
    };

    const handleAssetNameChange = (newAssetName: unknown) => {
      if (isRoot) return;
      const parentEntry = templateMap.get(selectedSystemTreeNodeParentTemplate!);
      if (!parentEntry) return;

      const updatedChildren = parentEntry.template.children.map((child, i) =>
        i === selectedSystemTreeNodeChildIndex
          ? { ...child, asset_name: String(newAssetName) }
          : child
      );
      updateTemplate(selectedSystemTreeNodeParentTemplate!, { children: updatedChildren });
    };

    const handleInstanceFieldChange = (fieldName: string, rawValue: unknown) => {
      if (isRoot) return;
      const parent = templateMap.get(selectedSystemTreeNodeParentTemplate!)?.template;
      if (!parent) return;

      const fieldDef = defaultFields[fieldName];
      const coerced = fieldDef
        ? coerceValue(rawValue, fieldDef.field_type as FieldType)
        : rawValue;

      const updatedChildren = parent.children.map((child, i) =>
        i === selectedSystemTreeNodeChildIndex
          ? { ...child, fields: { ...(child.fields || {}), [fieldName]: coerced } }
          : child
      );
      updateTemplate(selectedSystemTreeNodeParentTemplate!, { children: updatedChildren });
    };

    return (
      <div data-testid="fields-panel">
        <PropertiesHeader />
        <table className="w-full border-collapse">
          <tbody>
            <FieldTableRow fieldName="Template Name" value={template.template_name} readOnly />
            <FieldTableRow fieldName="Template Type" value={template.template_type} readOnly />

            {!isRoot && (
              <FieldTableRow
                fieldName="Asset Name"
                value={assetName ?? ''}
                isOverride={false}
                isDirtyField={originalChild !== undefined && assetName !== originalChild.asset_name}
                readOnly={false}
                onChange={(value) => handleAssetNameChange(value)}
              />
            )}

            {allKeys.map(key => {
              const fieldDef = defaultFields[key];
              const hasOverride = key in instanceOverrides;
              const displayValue = hasOverride ? instanceOverrides[key] : fieldDef?.default;
              return (
                <FieldTableRow
                  key={key}
                  fieldName={key}
                  value={displayValue}
                  fieldType={(fieldDef?.field_type ?? 'String') as FieldType}
                  isOverride={hasOverride}
                  isDirtyField={isDirtyField(key)}
                  readOnly={isRoot}
                  onChange={!isRoot ? (value) => handleInstanceFieldChange(key, value) : undefined}
                />
              );
            })}

            {allKeys.length === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-3 text-sm text-gray-500">
                  No fields defined.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return <div data-testid="fields-panel"><PropertiesHeader /></div>;
}

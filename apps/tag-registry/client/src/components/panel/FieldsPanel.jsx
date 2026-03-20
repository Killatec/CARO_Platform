import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Input } from '@caro/ui/primitives';
import { useUIStore } from '../../stores/useUIStore.js';
import { useTemplateGraphStore } from '../../stores/useTemplateGraphStore.js';
import { AddFieldModal } from '../shared/AddFieldModal.jsx';
import { TrashIcon } from '../shared/TrashIcon.jsx';
import { deepNotEqual } from '../../../../shared/utils.js';

function coerceValue(rawValue, fieldType) {
  if (fieldType === 'Boolean') return Boolean(rawValue);
  if (fieldType === 'Numeric') {
    const parsed = parseFloat(rawValue);
    return isNaN(parsed) ? 0 : parsed;
  }
  return String(rawValue);
}

/**
 * Renders a two-column table row: field name | input.
 * fieldType drives the input element: Numeric → number, Boolean → checkbox, String → text.
 * isOverride turns the input text blue (override) vs default black (inherited).
 */

function FieldTableRow({ fieldName, value, fieldType = 'String', isOverride = false, isDirtyField = false, readOnly = false, onChange, onDelete }) {
  const colorClass = isDirtyField
    ? 'text-orange-700 font-semibold'
    : isOverride
      ? 'text-blue-600 font-normal'
      : 'text-gray-700 font-normal';
  const nameCellClass = `py-1.5 pr-4 text-sm whitespace-nowrap pl-2 ${colorClass}`;

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
          value={value ?? ''}
          onChange={onChange ? (e) => onChange(e.target?.value ?? e) : undefined}
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

function PropertiesHeader({ onAdd }) {
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
 *
 * Selection is mutually exclusive (from useUIStore):
 *   selectedTemplateTree   → show template default fields (editable)
 *   selectedSystemTreeNode → show instance overrides + inherited defaults
 *   both null              → blank (header still visible)
 *
 * On every selection switch the panel goes blank for one tick before
 * repopulating, so state never bleeds between two items.
 *
 * Field shape in template.fields: { field_type: "Numeric"|"String"|"Boolean", default: <value> }
 * Instance override shape in child.fields: { fieldName: rawValue } (no field_type)
 */
export function FieldsPanel() {
  const selectedTemplateTree                 = useUIStore(state => state.selectedTemplateTree);
  const selectedSystemTreeNode               = useUIStore(state => state.selectedSystemTreeNode);
  const selectedSystemTreeNodeParentPath     = useUIStore(state => state.selectedSystemTreeNodeParentPath);
  const selectedSystemTreeNodeParentTemplate = useUIStore(state => state.selectedSystemTreeNodeParentTemplate);
  const selectedSystemTreeNodeChildIndex     = useUIStore(state => state.selectedSystemTreeNodeChildIndex);
  const templateMap         = useTemplateGraphStore(state => state.templateMap);
  const originalTemplateMap = useTemplateGraphStore(state => state.originalTemplateMap);
  const updateTemplate      = useTemplateGraphStore(state => state.updateTemplate);

  const [addFieldOpen, setAddFieldOpen] = useState(false);

  // ── Blank-on-switch logic ──────────────────────────────────────────────────
  const selectionKey =
    selectedTemplateTree   ? `t:${selectedTemplateTree}`   :
    selectedSystemTreeNode ? `s:${selectedSystemTreeNode}` :
    'blank';

  const [visible, setVisible] = useState(false);
  const prevKeyRef = useRef(null);

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

  // ── Resolve system-tree node data ─────────────────────────────────────────
  const nodeData = useMemo(() => {
    if (!selectedSystemTreeNode || !templateMap) return null;

    // Root node: parentPath is null
    if (!selectedSystemTreeNodeParentPath) {
      const entry = templateMap.get(selectedSystemTreeNode);
      if (!entry) return null;
      return {
        resolvedTemplateName: selectedSystemTreeNode,
        instanceOverrides: {},
        assetName: selectedSystemTreeNode,
        isRoot: true,
      };
    }

    const parentEntry = templateMap.get(selectedSystemTreeNodeParentTemplate);
    if (!parentEntry || selectedSystemTreeNodeChildIndex == null || selectedSystemTreeNodeChildIndex < 0) return null;

    const child = parentEntry.template.children?.[selectedSystemTreeNodeChildIndex];
    if (!child) return null;

    return {
      resolvedTemplateName: child.template_name,
      instanceOverrides: child.fields || {},
      assetName: child.asset_name,
      isRoot: false,
    };
  }, [selectedSystemTreeNode, selectedSystemTreeNodeParentPath, selectedSystemTreeNodeParentTemplate, selectedSystemTreeNodeChildIndex, templateMap]);

  // ── Blank state ───────────────────────────────────────────────────────────
  if (selectionKey === 'blank' || !visible) {
    return <div data-testid="fields-panel"><PropertiesHeader /></div>;
  }

  // ── Template-tree mode ────────────────────────────────────────────────────
  if (selectedTemplateTree) {
    const entry = templateMap.get(selectedTemplateTree);
    if (!entry) return <div data-testid="fields-panel"><PropertiesHeader /></div>;
    const { template } = entry;
    const fields = template.fields || {};
    const existingFieldNames = Object.keys(fields);
    const originalFields = originalTemplateMap.get(selectedTemplateTree)?.template?.fields ?? {};

    const handleFieldChange = (fieldName, rawValue) => {
      const fieldDef = fields[fieldName];
      const coerced = coerceValue(rawValue, fieldDef.field_type);
      updateTemplate(template.template_name, {
        fields: { ...fields, [fieldName]: { ...fieldDef, default: coerced } },
      });
    };

    const handleDeleteField = (fieldName) => {
      const updatedFields = { ...fields };
      delete updatedFields[fieldName];
      updateTemplate(template.template_name, { fields: updatedFields });
    };

    const handleAddField = (fieldName, fieldType, defaultValue) => {
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
                  fieldType={fieldDef.field_type}
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

  // ── System-tree node mode ─────────────────────────────────────────────────
  if (selectedSystemTreeNode && nodeData) {
    const templateEntry = templateMap.get(nodeData.resolvedTemplateName);
    if (!templateEntry) return <div data-testid="fields-panel"><PropertiesHeader /></div>;

    const { template } = templateEntry;
    const { instanceOverrides, assetName, isRoot } = nodeData;
    const defaultFields = template.fields || {}; // { fieldName: { field_type, default } }

    const allKeys = [
      ...Object.keys(defaultFields),
      ...Object.keys(instanceOverrides).filter(k => !(k in defaultFields)),
    ];

    const originalParent = originalTemplateMap.get(selectedSystemTreeNodeParentTemplate)?.template;
    const originalChild = originalParent?.children?.[selectedSystemTreeNodeChildIndex];
    const originalOverrides = originalChild?.fields ?? {};

    const isDirtyField = (fieldName) => {
      const currentValue = instanceOverrides[fieldName];
      if (!(fieldName in originalOverrides)) return currentValue !== undefined;
      return deepNotEqual(currentValue, originalOverrides[fieldName]);
    };

    const handleAssetNameChange = (newAssetName) => {
      if (isRoot) return;
      const parentEntry = templateMap.get(selectedSystemTreeNodeParentTemplate);
      if (!parentEntry) return;

      const updatedChildren = parentEntry.template.children.map((child, i) =>
        i === selectedSystemTreeNodeChildIndex
          ? { ...child, asset_name: newAssetName }
          : child
      );
      updateTemplate(selectedSystemTreeNodeParentTemplate, { children: updatedChildren });
    };

    const handleInstanceFieldChange = (fieldName, rawValue) => {
      if (isRoot) return;
      const parent = templateMap.get(selectedSystemTreeNodeParentTemplate)?.template;
      if (!parent) return;

      const fieldDef = defaultFields[fieldName];
      const coerced = fieldDef
        ? coerceValue(rawValue, fieldDef.field_type)
        : rawValue;

      const updatedChildren = parent.children.map((child, i) =>
        i === selectedSystemTreeNodeChildIndex
          ? { ...child, fields: { ...(child.fields || {}), [fieldName]: coerced } }
          : child
      );
      updateTemplate(selectedSystemTreeNodeParentTemplate, { children: updatedChildren });
    };

    return (
      <div data-testid="fields-panel">
        <PropertiesHeader />
        <table className="w-full border-collapse">
          <tbody>
            <FieldTableRow fieldName="Template Name" value={template.template_name} readOnly />
            <FieldTableRow fieldName="Template Type" value={template.template_type} readOnly />

            {/* Asset name row — root node has no parent to store an override in */}
            {!isRoot && (
              <FieldTableRow
                fieldName="Asset Name"
                value={assetName ?? ''}
                isOverride={false}
                readOnly={false}
                onChange={(value) => handleAssetNameChange(value)}
              />
            )}

            {/* Fields: blue text = override set, black text = template default */}
            {allKeys.map(key => {
              const fieldDef = defaultFields[key];
              const hasOverride = key in instanceOverrides;
              const displayValue = hasOverride ? instanceOverrides[key] : fieldDef?.default;
              return (
                <FieldTableRow
                  key={key}
                  fieldName={key}
                  value={displayValue}
                  fieldType={fieldDef?.field_type ?? 'String'}
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

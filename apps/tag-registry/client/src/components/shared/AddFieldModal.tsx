import React, { useState, useEffect } from 'react';
import { Modal, Button, Input } from '@caro/ui/primitives';
import { useTagTypesStore } from '../../stores/useTagTypesStore.js';

const TYPE_OPTIONS = ['Numeric', 'String', 'Boolean', 'TagType'] as const;
type FieldType = typeof TYPE_OPTIONS[number];

const EMPTY_DEFAULTS: Record<FieldType, number | string | boolean> = {
  Numeric: 0,
  String: '',
  Boolean: false,
  TagType: 'f32',
};

interface AddFieldModalProps {
  isOpen: boolean;
  onConfirm: (name: string, type: FieldType, defaultValue: number | string | boolean) => void;
  onCancel: () => void;
  existingFieldNames?: string[];
}

/**
 * AddFieldModal — collect field_name, field_type, and default_value for a new field.
 */
export function AddFieldModal({
  isOpen, onConfirm, onCancel, existingFieldNames = []
}: AddFieldModalProps): React.ReactElement | null {
  const tagTypes = useTagTypesStore(state => state.tagTypes);
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>('String');
  const [defaultValue, setDefaultValue] = useState<number | string | boolean>(EMPTY_DEFAULTS['String']);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setFieldName('');
      setFieldType('String');
      setDefaultValue(EMPTY_DEFAULTS['String']);
      setError('');
    }
  }, [isOpen]);

  const handleTypeChange = (newType: FieldType) => {
    setFieldType(newType);
    setDefaultValue(EMPTY_DEFAULTS[newType]);
  };

  const handleConfirm = () => {
    const trimmed = fieldName.trim();
    if (!trimmed) {
      setError('Field name is required.');
      return;
    }
    if (/[\s.]/.test(trimmed)) {
      setError('Field name must not contain spaces or dots.');
      return;
    }
    if (existingFieldNames.includes(trimmed)) {
      setError(`Field "${trimmed}" already exists on this template.`);
      return;
    }

    let coerced: number | string | boolean;
    if (fieldType === 'Numeric') {
      const parsed = parseFloat(String(defaultValue));
      coerced = isNaN(parsed) ? 0 : parsed;
    } else if (fieldType === 'Boolean') {
      coerced = Boolean(defaultValue);
    } else {
      coerced = String(defaultValue); // String and TagType
    }

    onConfirm(trimmed, fieldType, coerced);
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Add Field">
      <div className="space-y-4">

        <div>
          <label htmlFor="add-field-name" className="block text-sm font-medium text-gray-700 mb-1">Field Name</label>
          <Input
            id="add-field-name"
            value={fieldName}
            onChange={(e) => { setFieldName(e.target.value); setError(''); }}
            placeholder="e.g. eng_min"
            className="w-full"
          />
        </div>

        <div>
          <label htmlFor="add-field-type" className="block text-sm font-medium text-gray-700 mb-1">Field Type</label>
          <select
            id="add-field-type"
            value={fieldType}
            onChange={(e) => handleTypeChange(e.target.value as FieldType)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full"
          >
            {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="add-field-default" className="block text-sm font-medium text-gray-700 mb-1">Default Value</label>
          {fieldType === 'Boolean' ? (
            <input
              id="add-field-default"
              type="checkbox"
              checked={!!defaultValue}
              onChange={(e) => setDefaultValue(e.target.checked)}
              className="h-4 w-4"
            />
          ) : fieldType === 'TagType' ? (
            <select
              id="add-field-default"
              value={String(defaultValue)}
              onChange={(e) => setDefaultValue(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full"
            >
              {tagTypes.map(t => (
                <option key={t.type_name} value={t.type_name}>{t.display_name}</option>
              ))}
            </select>
          ) : (
            <Input
              id="add-field-default"
              type={fieldType === 'Numeric' ? 'number' : 'text'}
              value={String(defaultValue)}
              onChange={(e) => setDefaultValue(e.target.value)}
              className="w-full"
            />
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 pt-4 border-t">
          <Button variant="primary" onClick={handleConfirm}>Confirm</Button>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

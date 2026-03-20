import React, { useState, useEffect } from 'react';
import { Modal, Button, Input } from '@caro/ui/primitives';

const TYPE_OPTIONS = ['Numeric', 'String', 'Boolean'];

const EMPTY_DEFAULTS = {
  Numeric: 0,
  String: '',
  Boolean: false,
};

/**
 * AddFieldModal — collect field_name, field_type, and default_value for a new field.
 *
 * Props:
 *   isOpen            — controls visibility
 *   onConfirm(name, type, defaultValue) — called with validated, coerced values
 *   onCancel()        — called on cancel or close
 *   existingFieldNames — array of field names already on the template (for duplicate check)
 */
export function AddFieldModal({ isOpen, onConfirm, onCancel, existingFieldNames = [] }) {
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState('String');
  const [defaultValue, setDefaultValue] = useState(EMPTY_DEFAULTS['String']);
  const [error, setError] = useState('');

  // Reset form whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setFieldName('');
      setFieldType('String');
      setDefaultValue(EMPTY_DEFAULTS['String']);
      setError('');
    }
  }, [isOpen]);

  const handleTypeChange = (newType) => {
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

    let coerced;
    if (fieldType === 'Numeric') {
      const parsed = parseFloat(defaultValue);
      coerced = isNaN(parsed) ? 0 : parsed;
    } else if (fieldType === 'Boolean') {
      coerced = Boolean(defaultValue);
    } else {
      coerced = String(defaultValue);
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
            onChange={(e) => handleTypeChange(e.target.value)}
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
          ) : (
            <Input
              id="add-field-default"
              type={fieldType === 'Numeric' ? 'number' : 'text'}
              value={defaultValue}
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

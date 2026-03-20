import React from 'react';
import { FieldValueRow } from '../shared/FieldValueRow.jsx';

/**
 * FieldRow - wrapper around FieldValueRow widget
 */
export function FieldRow({ fieldName, value, dataType, isOverride, onChange, onDelete, readOnly }) {
  return (
    <FieldValueRow
      fieldName={fieldName}
      value={value}
      dataType={dataType}
      isOverride={isOverride}
      onChange={onChange}
      onDelete={onDelete}
      readOnly={readOnly}
    />
  );
}

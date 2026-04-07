import React from 'react';
import { FieldValueRow } from '../shared/FieldValueRow.jsx';

interface FieldRowProps {
  fieldName: string;
  value: unknown;
  dataType?: string;
  isOverride?: boolean;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  onDelete?: () => void;
  readOnly?: boolean;
}

/**
 * FieldRow - wrapper around FieldValueRow widget
 */
export function FieldRow({ fieldName, value, dataType, isOverride, onChange, onDelete, readOnly }: FieldRowProps): React.ReactElement {
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

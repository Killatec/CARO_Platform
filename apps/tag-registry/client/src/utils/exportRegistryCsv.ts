import type { DiffRow } from './diffRegistry.js';

/**
 * Column order and header labels mirror RegistryTable's visible columns
 * (the "meta" column is excluded — it's a modal trigger, not tabular data).
 */
const COLUMNS = [
  'tag_id',
  'tag_path',
  'tag_name',
  'module',
  'module_type',
  'data_type',
  'is_setpoint',
  'trends',
  'unit',
  'format',
  'eng_min',
  'eng_max',
  'status',
] as const;

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function cellValue(row: DiffRow, column: (typeof COLUMNS)[number], dataTypeLabels: Map<string, string>, moduleTypeLabels: Map<string, string>): string {
  switch (column) {
    case 'tag_id':
      return row.diffStatus === 'added' ? 'new' : row.tag_id !== undefined ? String(row.tag_id) : '';
    case 'tag_path':
      return row.tag_path;
    case 'tag_name':
      return row.tag_name ?? '';
    case 'module':
      return row.module ?? '';
    case 'module_type':
      return row.module_type ? (moduleTypeLabels.get(row.module_type) ?? row.module_type) : '';
    case 'data_type':
      return dataTypeLabels.get(row.data_type) ?? row.data_type;
    case 'is_setpoint':
      return row.is_setpoint ? 'true' : 'false';
    case 'trends':
      return row.trends ? 'true' : 'false';
    case 'unit':
      return row.unit ?? '';
    case 'format':
      return row.format ?? '';
    case 'eng_min':
      return row.eng_min !== null && row.eng_min !== undefined ? String(row.eng_min) : '';
    case 'eng_max':
      return row.eng_max !== null && row.eng_max !== undefined ? String(row.eng_max) : '';
    case 'status':
      return row.diffStatus;
    default:
      return '';
  }
}

/**
 * Builds CSV text for the registry table, matching the columns and display
 * conventions (labels, "new" for added rows, boolean-as-string) currently
 * shown on screen. Pure function — no side effects.
 */
export function buildRegistryCsv(
  rows: DiffRow[],
  dataTypeLabels: Map<string, string> = new Map(),
  moduleTypeLabels: Map<string, string> = new Map()
): string {
  const header = COLUMNS.join(',');
  const lines = rows.map(row =>
    COLUMNS
      .map(col => csvEscape(cellValue(row, col, dataTypeLabels, moduleTypeLabels)))
      .join(',')
  );
  return [header, ...lines].join('\r\n');
}

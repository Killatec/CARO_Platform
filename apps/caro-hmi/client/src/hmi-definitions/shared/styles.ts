import type { CSSProperties } from 'react';

export const PAGE_STYLE: CSSProperties = {
  padding: 0,
};

export const HEADING_STYLE: CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: '#1a1a2e',
  marginBottom: 20,
};

export const MODULES_CONTAINER: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 16,
  alignItems: 'flex-start',
};

export const MODULE_BOX: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 8,
  padding: 16,
  background: '#fafafa',
};

export const MODULE_TITLE: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#1a1a2e',
  marginBottom: 12,
  paddingBottom: 6,
  borderBottom: '2px solid #e5e7eb',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

export const WIDGET_STACK: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

export const SECTION_BOX: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 8,
  padding: 16,
  background: '#fafafa',
  width: 'fit-content',
};

/** MODULE_BOX variant with bottom margin — use for boxes that stack vertically above other sections. */
export const STATUS_BOX: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 8,
  padding: 16,
  background: '#fafafa',
  marginBottom: 16,
};

export const ANALOG_IN_STACK: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  alignItems: 'flex-start',
};

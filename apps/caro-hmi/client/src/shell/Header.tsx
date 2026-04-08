import type { CSSProperties } from 'react';

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 48,
  padding: '0 16px',
  background: '#1a1a2e',
  color: '#fff',
  flexShrink: 0,
};

const TITLE_STYLE: CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  letterSpacing: '0.02em',
};

const BADGE_STYLE: CSSProperties = {
  fontSize: 12,
  color: '#aaa',
};

export function Header() {
  return (
    <header style={HEADER_STYLE}>
      <span style={TITLE_STYLE}>CARO HMI</span>
      <span style={BADGE_STYLE}>Phase 3 — No Auth</span>
    </header>
  );
}

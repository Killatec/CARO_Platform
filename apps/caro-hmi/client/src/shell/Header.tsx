import type { CSSProperties } from 'react';
import { resetAll } from '../api/reset.js';

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

function handleReset() {
  void resetAll().then(() => {
    window.dispatchEvent(new CustomEvent('system-reset'));
  });
}

export function Header() {
  return (
    <header style={HEADER_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={TITLE_STYLE}>CARO HMI</span>
        <button
          onClick={handleReset}
          title="Reset"
          className="flex items-center justify-center w-7 h-7 rounded text-white/70 bg-transparent hover:bg-white/10 hover:text-white cursor-pointer border-0"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      </div>
      <span style={BADGE_STYLE}>Phase 3 — No Auth</span>
    </header>
  );
}

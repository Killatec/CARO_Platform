import { useState, useEffect, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { Modal } from '@caro/ui';
import type { TagDef } from '@caro/hmi-context';
import { colorAssign } from './colorAssign.js';

export interface TagPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCommit: (tagIds: number[]) => void;
  currentTagIds: number[];
  tagMap: Map<number, TagDef>;
  maxTags?: number;
}

const DEFAULT_MAX_TAGS = 16;
const FONT_WIDTH_PX = 7.2;       // 12px monospace
const LEFT_PANE_PADDING_PX = 100; // row padding + scrollbar + breathing room
const MIN_LEFT_PANE_PX = 200;

// ── Styles ────────────────────────────────────────────────────────────────────

const OUTER_WRAPPER: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  height: 'calc(90vh - 8rem)',
  maxHeight: 'calc(90vh - 8rem)',
};

const PANE_ROW: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  gap: 12,
  overflow: 'hidden',
};

const RIGHT_PANE: CSSProperties = {
  flex: '0 0 280px',
  minWidth: 280,
  overflowY: 'auto',
  border: '1px solid #e5e7eb',
  borderRadius: 4,
  padding: 8,
};

const SEARCH_BOX: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'monospace',
  outline: 'none',
  flexShrink: 0,
};

const ERROR_ROW: CSSProperties = {
  fontSize: 12,
  fontFamily: 'monospace',
  lineHeight: '16px',
  color: '#dc2626',
  flexShrink: 0,
};

const FOOTER_ROW: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  flexShrink: 0,
};

const BTN_BASE: CSSProperties = {
  padding: '6px 16px',
  borderRadius: 4,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'monospace',
};

const BTN_CANCEL: CSSProperties = {
  ...BTN_BASE,
  background: '#fff',
  border: '1px solid #d1d5db',
  color: '#374151',
};

const BTN_OK: CSSProperties = {
  ...BTN_BASE,
  background: '#2563eb',
  border: '1px solid #2563eb',
  color: '#fff',
};

const RIGHT_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
  fontSize: 12,
  fontFamily: 'monospace',
  lineHeight: '18px',
};

const SWATCH: CSSProperties = {
  display: 'inline-block',
  width: 10,
  height: 10,
  borderRadius: 2,
  flexShrink: 0,
};

const REMOVE_BTN: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#9ca3af',
  padding: '0 2px',
  fontSize: 14,
  lineHeight: 1,
  marginLeft: 'auto',
};

// ── Main modal component ──────────────────────────────────────────────────────

export function TagPickerModal({
  isOpen,
  onClose,
  onCommit,
  currentTagIds,
  tagMap,
  maxTags = DEFAULT_MAX_TAGS,
}: TagPickerModalProps) {
  const [stagedIds, setStagedIds] = useState<number[]>([]);
  const [search, setSearch]       = useState('');
  const [error, setError]         = useState<string | null>(null);

  // Reset staged state when modal opens.
  useEffect(() => {
    if (isOpen) {
      setStagedIds([...currentTagIds]);
      setSearch('');
      setError(null);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableTags = useMemo(() => {
    const tags: TagDef[] = [];
    for (const tag of tagMap.values()) {
      if (tag.trendable) tags.push(tag);
    }
    tags.sort((a, b) => {
      const an = a.tag_name ?? `Tag-${a.tag_id}`;
      const bn = b.tag_name ?? `Tag-${b.tag_id}`;
      return an.localeCompare(bn);
    });
    return tags;
  }, [tagMap]);

  const trimmedSearch = search.trim().toLowerCase();
  const filteredTags = useMemo(() => {
    if (!trimmedSearch) return availableTags;
    return availableTags.filter(tag => {
      const label = (tag.tag_name ?? `Tag-${tag.tag_id}`).toLowerCase();
      return label.includes(trimmedSearch);
    });
  }, [availableTags, trimmedSearch]);

  const leftPaneWidth = useMemo(() => {
    const maxLen = availableTags.reduce((max, tag) => {
      const name = tag.tag_name ?? `Tag-${tag.tag_id}`;
      return name.length > max ? name.length : max;
    }, 0);
    return Math.max(
      MIN_LEFT_PANE_PX,
      Math.ceil(maxLen * FONT_WIDTH_PX) + LEFT_PANE_PADDING_PX,
    );
  }, [availableTags]);

  const handleStage = useCallback((tag: TagDef) => {
    setStagedIds(prev => {
      if (prev.length >= maxTags) {
        setError(`Max ${maxTags} signals. Remove one to add another.`);
        return prev;
      }
      setError(null);
      return [...prev, tag.tag_id];
    });
  }, [maxTags]);

  const handleUnstage = useCallback((tagId: number) => {
    setStagedIds(prev => prev.filter(id => id !== tagId));
    setError(null);
  }, []);

  const handleOk = useCallback(() => {
    onCommit(stagedIds);
    onClose();
  }, [onCommit, onClose, stagedIds]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Signals"
      outerStyle={{ maxWidth: '64rem', padding: 24 }}
      headerStyle={{ padding: '0 0 12px 0' }}
      bodyStyle={{ padding: 0, overflow: 'hidden' }}
    >
      <div style={OUTER_WRAPPER}>
      <input
        type="text"
        placeholder="Search tags…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={SEARCH_BOX}
        aria-label="Search tags"
      />
      <div style={PANE_ROW}>
        {/* Left pane — flat alphabetical list of trendable tags */}
        <div style={{ width: leftPaneWidth, minWidth: leftPaneWidth, flex: '0 0 auto', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 4, padding: 8 }} role="list" aria-label="Available tags">
          {filteredTags.map(tag => {
            const label = tag.tag_name ?? `Tag-${tag.tag_id}`;
            const isStaged = stagedIds.includes(tag.tag_id);
            const rowStyle: CSSProperties = {
              padding: '4px 8px',
              fontSize: 12,
              fontFamily: 'monospace',
              lineHeight: '18px',
              cursor: isStaged ? 'default' : 'pointer',
              userSelect: 'none',
              fontWeight: isStaged ? 700 : 400,
              background: isStaged ? '#f3f4f6' : 'transparent',
              color: '#374151',
              borderBottom: '1px solid #f3f4f6',
            };
            return (
              <div
                key={tag.tag_id}
                style={rowStyle}
                onClick={isStaged ? undefined : () => handleStage(tag)}
                title={tag.tag_path}
                role="listitem"
              >
                {label}
              </div>
            );
          })}
        </div>
        {/* Right pane — staged list */}
        <div style={RIGHT_PANE} aria-label="Staged signals">
          {stagedIds.map(tagId => {
            const tag = tagMap.get(tagId);
            const label = tag?.tag_name ?? `Tag-${tagId}`;
            const color = colorAssign(tagId);
            return (
              <div key={tagId} style={RIGHT_ROW}>
                <span style={{ ...SWATCH, background: color }} />
                <span style={{ flex: 1, whiteSpace: 'nowrap' }}>
                  {label}
                </span>
                <button
                  style={REMOVE_BTN}
                  onClick={() => handleUnstage(tagId)}
                  title={`Remove ${label}`}
                  aria-label={`Remove ${label}`}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#374151'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {error !== null && <div style={ERROR_ROW} role="alert">{error}</div>}
      <div style={FOOTER_ROW}>
        <button style={BTN_CANCEL} onClick={onClose}>Cancel</button>
        <button style={BTN_OK} onClick={handleOk}>OK</button>
      </div>
      </div>
    </Modal>
  );
}

import { describe, it, expect } from 'vitest';
import { parseAttachmentFileName } from './tagDefs.js';

describe('parseAttachmentFileName', () => {
  it('extracts the quoted filename from an attachment header', () => {
    expect(parseAttachmentFileName('attachment; filename="TagDefs_2026-09-26_143012.zip"'))
      .toBe('TagDefs_2026-09-26_143012.zip');
  });

  it('returns null when the header is missing', () => {
    expect(parseAttachmentFileName(null)).toBeNull();
  });

  it('returns null when the header has no quoted filename', () => {
    expect(parseAttachmentFileName('attachment')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { HandshakeStatus, HandshakeStatusLabels } from '../enums/handshakeStatus.js';

describe('HandshakeStatusLabels', () => {
  it('has a label for every HandshakeStatus code', () => {
    for (const code of Object.values(HandshakeStatus)) {
      expect(HandshakeStatusLabels[code]).toBeTypeOf('string');
    }
  });

  it('codes are distinct', () => {
    const codes = Object.values(HandshakeStatus);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

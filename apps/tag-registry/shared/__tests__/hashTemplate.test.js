import { describe, it, expect } from 'vitest';
import { hashTemplate } from '../hashTemplate.js';

describe('hashTemplate', () => {
  it('returns a 6-character string', () => {
    expect(hashTemplate({ template_name: 'a' })).toHaveLength(6);
  });

  it('returns only lowercase hex characters', () => {
    const hash = hashTemplate({ template_name: 'a', template_type: 'tag' });
    expect(hash).toMatch(/^[0-9a-f]{6}$/);
  });

  it('same template always produces the same hash', () => {
    const t = { template_name: 'my_tag', template_type: 'tag', data_type: 'f64', is_setpoint: false };
    expect(hashTemplate(t)).toBe(hashTemplate(t));
  });

  it('key order does not affect the hash', () => {
    const a = hashTemplate({ b: 1, a: 2 });
    const b = hashTemplate({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('different templates produce different hashes', () => {
    const h1 = hashTemplate({ template_name: 'tag_a' });
    const h2 = hashTemplate({ template_name: 'tag_b' });
    expect(h1).not.toBe(h2);
  });

  it('adding a field changes the hash', () => {
    const before = hashTemplate({ template_name: 'x', fields: {} });
    const after  = hashTemplate({ template_name: 'x', fields: { eng_min: { field_type: 'Numeric', default: 0 } } });
    expect(before).not.toBe(after);
  });

  it('changing a field value changes the hash', () => {
    const before = hashTemplate({ template_name: 'x', fields: { eng_min: { field_type: 'Numeric', default: 0 } } });
    const after  = hashTemplate({ template_name: 'x', fields: { eng_min: { field_type: 'Numeric', default: 1 } } });
    expect(before).not.toBe(after);
  });

  it('nested objects are canonicalised (key order independent)', () => {
    const a = hashTemplate({ a: { z: 1, y: 2 } });
    const b = hashTemplate({ a: { y: 2, z: 1 } });
    expect(a).toBe(b);
  });
});

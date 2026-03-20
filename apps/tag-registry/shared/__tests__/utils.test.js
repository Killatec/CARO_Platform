import { describe, it, expect } from 'vitest';
import { deepEqual, deepNotEqual } from '../utils.js';

describe('deepEqual', () => {
  it('equal numbers', () => expect(deepEqual(1, 1)).toBe(true));
  it('equal strings', () => expect(deepEqual('a', 'a')).toBe(true));
  it('equal nulls', () => expect(deepEqual(null, null)).toBe(true));
  it('equal plain objects', () => expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true));
  it('equal arrays', () => expect(deepEqual([1, 2], [1, 2])).toBe(true));
  it('equal nested objects', () => expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true));
  it('different numbers', () => expect(deepEqual(1, 2)).toBe(false));
  it('different object values', () => expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false));
  it('different array elements', () => expect(deepEqual([1, 2], [1, 3])).toBe(false));
  it('null vs undefined', () => expect(deepEqual(null, undefined)).toBe(false));
});

describe('deepNotEqual', () => {
  it('equal numbers → false', () => expect(deepNotEqual(1, 1)).toBe(false));
  it('equal strings → false', () => expect(deepNotEqual('a', 'a')).toBe(false));
  it('equal nulls → false', () => expect(deepNotEqual(null, null)).toBe(false));
  it('equal plain objects → false', () => expect(deepNotEqual({ a: 1 }, { a: 1 })).toBe(false));
  it('equal arrays → false', () => expect(deepNotEqual([1, 2], [1, 2])).toBe(false));
  it('equal nested objects → false', () => expect(deepNotEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(false));
  it('different numbers → true', () => expect(deepNotEqual(1, 2)).toBe(true));
  it('different object values → true', () => expect(deepNotEqual({ a: 1 }, { a: 2 })).toBe(true));
  it('different array elements → true', () => expect(deepNotEqual([1, 2], [1, 3])).toBe(true));
  it('null vs undefined → true', () => expect(deepNotEqual(null, undefined)).toBe(true));
});

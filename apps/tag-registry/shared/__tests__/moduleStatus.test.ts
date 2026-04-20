import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ModuleStatus, ModuleStatusLabels } from '../enums/moduleStatus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const jsonPath = resolve(__dirname, '../enums/moduleStatus.json');
const jsonData = JSON.parse(readFileSync(jsonPath, 'utf-8')) as Record<string, number>;

describe('ModuleStatus TS const', () => {
  it('has the expected codes', () => {
    expect(ModuleStatus.UNKNOWN).toBe(0);
    expect(ModuleStatus.OK).toBe(1);
    expect(ModuleStatus.WARNING).toBe(2);
    expect(ModuleStatus.FAULT).toBe(3);
    expect(ModuleStatus.STALLED).toBe(4);
  });
});

describe('ModuleStatusLabels', () => {
  it('has a label for every ModuleStatus code', () => {
    for (const [key, code] of Object.entries(ModuleStatus)) {
      expect(ModuleStatusLabels[code]).toBe(key);
    }
  });
});

describe('ModuleStatus TS const / JSON sync', () => {
  it('JSON keys match TS const keys', () => {
    const tsKeys   = Object.keys(ModuleStatus).sort();
    const jsonKeys = Object.keys(jsonData).sort();
    expect(jsonKeys).toEqual(tsKeys);
  });

  it('JSON values match TS const values for every key', () => {
    for (const [key, tsValue] of Object.entries(ModuleStatus)) {
      expect(jsonData[key]).toBe(tsValue);
    }
  });
});

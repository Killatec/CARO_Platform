import { describe, it, expect } from 'vitest';
import { buildRegistryCsv } from './exportRegistryCsv.js';
import type { DiffRow } from './diffRegistry.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<DiffRow> = {}): DiffRow {
  return {
    tag_path: 'Root.A',
    module: null,
    module_type: null,
    data_type: 'f32',
    is_setpoint: false,
    meta: null,
    diffStatus: 'unchanged',
    ...overrides,
  };
}

const HEADER = 'tag_id,tag_path,tag_name,module,module_type,data_type,is_setpoint,trends,unit,format,eng_min,eng_max,status';

// ── Header ────────────────────────────────────────────────────────────────────

describe('buildRegistryCsv — header', () => {
  it('emits the header row even for an empty row set', () => {
    expect(buildRegistryCsv([])).toBe(HEADER);
  });
});

// ── Basic field mapping ───────────────────────────────────────────────────────

describe('buildRegistryCsv — field mapping', () => {
  it('renders a fully-populated unchanged row', () => {
    const row = makeRow({
      tag_id: 42,
      tag_path: 'Root.A.setpoint',
      tag_name: 'A_SP',
      module: 'Sys1',
      module_type: 'HMI',
      data_type: 'f32',
      is_setpoint: true,
      trends: true,
      unit: 'V',
      format: '#.##',
      eng_min: 0,
      eng_max: 100,
    });
    const csv = buildRegistryCsv([row]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('42,Root.A.setpoint,A_SP,Sys1,HMI,f32,true,true,V,#.##,0,100,unchanged');
  });

  it('renders "new" for tag_id on an added row instead of a blank', () => {
    const row = makeRow({ diffStatus: 'added', tag_id: undefined });
    const csv = buildRegistryCsv([row]);
    expect(csv.split('\r\n')[1].startsWith('new,')).toBe(true);
  });

  it('renders blank for a missing tag_id on a non-added row', () => {
    const row = makeRow({ diffStatus: 'unchanged', tag_id: undefined });
    const csv = buildRegistryCsv([row]);
    expect(csv.split('\r\n')[1].startsWith(',')).toBe(true);
  });

  it('renders null/undefined optional fields as blank, not "null" or "—"', () => {
    const row = makeRow({
      tag_name: null,
      module: null,
      module_type: null,
      unit: null,
      format: null,
      eng_min: null,
      eng_max: null,
    });
    const csv = buildRegistryCsv([row]);
    const cells = csv.split('\r\n')[1].split(',');
    // tag_id, tag_path, tag_name, module, module_type, data_type, is_setpoint, trends, unit, format, eng_min, eng_max, status
    expect(cells[2]).toBe(''); // tag_name
    expect(cells[3]).toBe(''); // module
    expect(cells[4]).toBe(''); // module_type
    expect(cells[8]).toBe(''); // unit
    expect(cells[9]).toBe(''); // format
    expect(cells[10]).toBe(''); // eng_min
    expect(cells[11]).toBe(''); // eng_max
  });

  it('renders booleans as literal true/false strings', () => {
    const row = makeRow({ is_setpoint: false, trends: false });
    const csv = buildRegistryCsv([row]);
    const cells = csv.split('\r\n')[1].split(',');
    expect(cells[6]).toBe('false'); // is_setpoint
    expect(cells[7]).toBe('false'); // trends
  });
});

// ── Display-name label maps ───────────────────────────────────────────────────

describe('buildRegistryCsv — label maps', () => {
  it('maps data_type through the provided display-name map', () => {
    const row = makeRow({ data_type: 'f32' });
    const csv = buildRegistryCsv([row], new Map([['f32', 'Float32']]));
    expect(csv.split('\r\n')[1].split(',')[5]).toBe('Float32');
  });

  it('falls back to the raw code when no label map entry exists', () => {
    const row = makeRow({ data_type: 'unknown_type' });
    const csv = buildRegistryCsv([row]);
    expect(csv.split('\r\n')[1].split(',')[5]).toBe('unknown_type');
  });

  it('maps module_type through the provided display-name map', () => {
    const row = makeRow({ module_type: 'HMI' });
    const csv = buildRegistryCsv([row], undefined, new Map([['HMI', 'Human-Machine Interface']]));
    expect(csv.split('\r\n')[1].split(',')[4]).toBe('Human-Machine Interface');
  });
});

// ── CSV escaping ──────────────────────────────────────────────────────────────

describe('buildRegistryCsv — escaping', () => {
  it('quotes a field containing a comma', () => {
    const row = makeRow({ tag_name: 'A, B' });
    const csv = buildRegistryCsv([row]);
    expect(csv.split('\r\n')[1]).toContain('"A, B"');
  });

  it('quotes and doubles embedded quotes', () => {
    const row = makeRow({ tag_name: 'A "quoted" B' });
    const csv = buildRegistryCsv([row]);
    expect(csv.split('\r\n')[1]).toContain('"A ""quoted"" B"');
  });

  it('quotes a field containing a newline', () => {
    const row = makeRow({ tag_name: 'line1\nline2' });
    const csv = buildRegistryCsv([row]);
    expect(csv.split('\r\n')[1]).toContain('"line1\nline2"');
  });

  it('leaves plain fields unquoted', () => {
    const row = makeRow({ tag_path: 'Root.Plain' });
    const csv = buildRegistryCsv([row]);
    expect(csv.split('\r\n')[1]).toContain('Root.Plain');
    expect(csv.split('\r\n')[1]).not.toContain('"Root.Plain"');
  });
});

// ── Row order ─────────────────────────────────────────────────────────────────

describe('buildRegistryCsv — row order', () => {
  it('preserves the order of the input rows', () => {
    const rows = [
      makeRow({ tag_path: 'Root.C' }),
      makeRow({ tag_path: 'Root.A' }),
      makeRow({ tag_path: 'Root.B' }),
    ];
    const lines = buildRegistryCsv(rows).split('\r\n').slice(1);
    expect(lines.map(l => l.split(',')[1])).toEqual(['Root.C', 'Root.A', 'Root.B']);
  });
});

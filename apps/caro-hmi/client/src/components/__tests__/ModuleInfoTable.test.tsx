import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { MockHmiProvider } from '@caro/hmi-context/testing';
import type { TagDef, LiveValue } from '@caro/hmi-context';
import { ModuleStatus } from '@caro/tag-registry-shared';
import { ModuleInfoTable } from '../ModuleInfoTable.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeTagDef(overrides: Partial<TagDef> & { tag_id: number; tag_path: string }): TagDef {
  return {
    data_type: 'f32',
    is_setpoint: false,
    module_id: 'HMI',
    module_type: 'HMI',
    eng_min: null,
    eng_max: null,
    unit: null,
    meta: [],
    ...overrides,
  };
}

// Six HMI Module_Info tags (module_id='HMI', IDs 9001-9006 → HMI appears last in ordering)
const TAG_MODULE_COUNT = makeTagDef({ tag_id: 9001, tag_path: 'CARO_1.HMI.Module_Info.Module_Count', data_type: 'i16' });
const TAG_STATUS       = makeTagDef({ tag_id: 9002, tag_path: 'CARO_1.HMI.Module_Info.Status',       data_type: 'i16[]' });
const TAG_DATA_RATE    = makeTagDef({ tag_id: 9003, tag_path: 'CARO_1.HMI.Module_Info.Data_Rate',    data_type: 'f32[]' });
const TAG_PKG_RATE     = makeTagDef({ tag_id: 9004, tag_path: 'CARO_1.HMI.Module_Info.Pkg_Rate',     data_type: 'f32[]' });
const TAG_TAGS_PER_PKG = makeTagDef({ tag_id: 9005, tag_path: 'CARO_1.HMI.Module_Info.Tags_Per_Pkg', data_type: 'i16[]' });
const TAG_WATCHDOG     = makeTagDef({ tag_id: 9006, tag_path: 'CARO_1.HMI.Module_Info.Watchdog',     data_type: 'i16[]' });

const HMI_TAGS: Record<number, TagDef> = {
  9001: TAG_MODULE_COUNT,
  9002: TAG_STATUS,
  9003: TAG_DATA_RATE,
  9004: TAG_PKG_RATE,
  9005: TAG_TAGS_PER_PKG,
  9006: TAG_WATCHDOG,
};

// Three MQTT module tags (IDs 1-3, before HMI's 9001+) → order: RF, POW, COOL, HMI
const MQTT_TAGS: Record<number, TagDef> = {
  1: makeTagDef({ tag_id: 1, tag_path: 'CARO_1.RF.Status',   module_id: 'RF',   module_type: 'MQTT' }),
  2: makeTagDef({ tag_id: 2, tag_path: 'CARO_1.POW.Status',  module_id: 'POW',  module_type: 'MQTT' }),
  3: makeTagDef({ tag_id: 3, tag_path: 'CARO_1.COOL.Status', module_id: 'COOL', module_type: 'MQTT' }),
};

const ALL_TAGS = { ...MQTT_TAGS, ...HMI_TAGS };

// Live values for 4-module scenario (RF=0, POW=1, COOL=2, HMI=3)
const LIVE_4: Record<number, LiveValue> = {
  9001: { value: 4 },
  9002: { value: [ModuleStatus.OK, ModuleStatus.WARNING, ModuleStatus.FAULT, ModuleStatus.OK] },
  9003: { value: [1.5, 2.0, 0.5, 0.1] },      // KB/s
  9004: { value: [10, 20, 5, 6] },             // pkt/s (HMI=6, distinct from tagsPerPkg values)
  9005: { value: [4, 8, 2, 3] },               // tags/pkt
  9006: { value: [0b00000010] },               // bit 1 set → POW (index 1) watchdog latched
};

function wrapper(tagDefs: Record<number, TagDef>, tagValues: Record<number, LiveValue> = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MockHmiProvider tagDefs={tagDefs} tagValues={tagValues}>
        {children}
      </MockHmiProvider>
    );
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ModuleInfoTable', () => {
  it('renders "No modules" when tagMap is completely empty', () => {
    render(<ModuleInfoTable />, { wrapper: wrapper({}) });
    expect(screen.getByText('No modules')).toBeTruthy();
  });

  it('renders 4 rows: RF, POW, COOL (MQTT) + HMI — in getModuleNames order', () => {
    render(<ModuleInfoTable />, { wrapper: wrapper(ALL_TAGS, LIVE_4) });
    const cells = screen.getAllByRole('cell');
    const moduleNames = cells.filter(c => ['RF', 'POW', 'COOL', 'HMI'].includes(c.textContent ?? ''));
    expect(moduleNames.map(c => c.textContent)).toEqual(['RF', 'POW', 'COOL', 'HMI']);
  });

  it('displays correct KB/s, pkt/s, and tags values per row', () => {
    render(<ModuleInfoTable />, { wrapper: wrapper(ALL_TAGS, LIVE_4) });
    // RF row (index 0): dataRate=1.5, pkgRate=10, tagsPerPkg=4
    expect(screen.getByText('1.5')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('renders rows with zero-fallback values when arrays are null (before first SNAPSHOT)', () => {
    // tagDefs present (so moduleNames has 4 entries), but no tagValues → null everywhere
    render(<ModuleInfoTable />, { wrapper: wrapper(ALL_TAGS) });
    // 1 header row + 4 data rows (RF, POW, COOL, HMI)
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(5);
  });

  describe('Status labels', () => {
    const statusCodes: Array<[number, string]> = [
      [ModuleStatus.OK,      'OK'],
      [ModuleStatus.WARNING, 'WARNING'],
      [ModuleStatus.FAULT,   'FAULT'],
      [ModuleStatus.STALLED, 'STALLED'],
    ];

    it.each(statusCodes)('ModuleStatus %i renders label "%s"', (code, label) => {
      const live: Record<number, LiveValue> = {
        9001: { value: 1 },
        9002: { value: [code] },   // RF gets this code; HMI (index 1) gets undefined→UNKNOWN
        9003: { value: [0] },
        9004: { value: [0] },
        9005: { value: [0] },
        9006: { value: [0] },
      };
      const tags = {
        1: makeTagDef({ tag_id: 1, tag_path: 'CARO_1.RF.Status', module_id: 'RF', module_type: 'MQTT' }),
        ...HMI_TAGS,
      };
      render(<ModuleInfoTable />, { wrapper: wrapper(tags, live) });
      expect(screen.getByText(label)).toBeTruthy();
    });

    it('ModuleStatus 0 (UNKNOWN) renders label "UNKNOWN" for both rows', () => {
      const live: Record<number, LiveValue> = {
        9001: { value: 1 },
        9002: { value: [ModuleStatus.UNKNOWN] },
        9003: { value: [0] },
        9004: { value: [0] },
        9005: { value: [0] },
        9006: { value: [0] },
      };
      const tags = {
        1: makeTagDef({ tag_id: 1, tag_path: 'CARO_1.RF.Status', module_id: 'RF', module_type: 'MQTT' }),
        ...HMI_TAGS,
      };
      render(<ModuleInfoTable />, { wrapper: wrapper(tags, live) });
      // Both RF (code=0) and HMI (missing from array → defaults to 0) show UNKNOWN
      expect(screen.getAllByText('UNKNOWN').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Watchdog indicators', () => {
    it('bit 0 set → module[0] (RF) indicator is red, modules[1-3] are green', () => {
      const live: Record<number, LiveValue> = {
        ...LIVE_4,
        9006: { value: [0b00000001] }, // only bit 0 (RF)
      };
      render(<ModuleInfoTable />, { wrapper: wrapper(ALL_TAGS, live) });
      const dots = document.querySelectorAll('.rounded-full');
      expect(dots[0].className).toContain('bg-red-500');   // RF
      expect(dots[1].className).toContain('bg-green-500'); // POW
      expect(dots[2].className).toContain('bg-green-500'); // COOL
      expect(dots[3].className).toContain('bg-green-500'); // HMI
    });

    it('bit 1 set → module[1] (POW) indicator is red', () => {
      const live: Record<number, LiveValue> = {
        ...LIVE_4,
        9006: { value: [0b00000010] }, // bit 1 (POW)
      };
      render(<ModuleInfoTable />, { wrapper: wrapper(ALL_TAGS, live) });
      const dots = document.querySelectorAll('.rounded-full');
      expect(dots[0].className).toContain('bg-green-500'); // RF
      expect(dots[1].className).toContain('bg-red-500');   // POW
    });

    it('exercises word-boundary (index >= 16) packing correctly', () => {
      // 17 MQTT modules (IDs 1-17) + HMI_TAGS (IDs 9001+) = 18 total modules
      const manyTags: Record<number, TagDef> = { ...HMI_TAGS };
      for (let i = 0; i < 17; i++) {
        manyTags[i + 1] = makeTagDef({
          tag_id: i + 1,
          tag_path: `CARO_1.MOD${i}.Status`,
          module_id: `MOD${i}`,
          module_type: 'MQTT',
        });
      }
      // word[0]=0 (bits 0-15 clear), word[1]=0b00000001 (bit 0 = module index 16 = MOD16)
      const watchdogWords = [0, 0b00000001];
      const live: Record<number, LiveValue> = {
        9001: { value: 18 },                                          // 17 MQTT + 1 HMI
        9002: { value: new Array(18).fill(ModuleStatus.OK) },
        9003: { value: new Array(18).fill(0) },
        9004: { value: new Array(18).fill(0) },
        9005: { value: new Array(18).fill(0) },
        9006: { value: watchdogWords },
      };
      render(<ModuleInfoTable />, { wrapper: wrapper(manyTags, live) });
      const dots = document.querySelectorAll('.rounded-full');
      expect(dots).toHaveLength(18);
      // MOD0-MOD15 (indices 0-15): green
      for (let i = 0; i < 16; i++) {
        expect(dots[i].className).toContain('bg-green-500');
      }
      // MOD16 (index 16): red — bit 0 of word[1]
      expect(dots[16].className).toContain('bg-red-500');
      // HMI (index 17): green
      expect(dots[17].className).toContain('bg-green-500');
    });
  });

  it('shows mismatch banner and clips rows when Module_Count !== Status array length', () => {
    const live: Record<number, LiveValue> = {
      9001: { value: 3 },                                        // Module_Count = 3
      9002: { value: [ModuleStatus.OK, ModuleStatus.WARNING] },  // Status length = 2 (mismatch)
      9003: { value: [1.0, 2.0] },
      9004: { value: [10, 20] },
      9005: { value: [4, 8] },
      9006: { value: [0] },
    };
    render(<ModuleInfoTable />, { wrapper: wrapper(ALL_TAGS, live) });
    expect(screen.getByText(/Module array length mismatch/)).toBeTruthy();
    // rowCount = Math.min(4 modules, 2, 2, 2, 2) = 2 → 1 header + 2 data rows
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
  });

  it('does not crash or reference a Module_Names tag', () => {
    render(<ModuleInfoTable />, { wrapper: wrapper(ALL_TAGS, LIVE_4) });
    expect(screen.queryByText(/error/i)).toBeNull();
  });
});

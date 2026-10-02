import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { unzipSync, strFromU8 } from 'fflate';

vi.mock('../src/services/templateService.ts', () => ({
  initializeIndex: vi.fn(),
  listTemplates:   vi.fn(),
  getTemplate:     vi.fn(),
  batchSave:       vi.fn(),
  loadRoot:        vi.fn(),
  validateAll:     vi.fn(),
  deleteTemplate:  vi.fn(),
}));

import { createApp } from '../src/app.ts';
import * as templateService from '../src/services/templateService.ts';
import { tagDefsZipName } from '../src/services/tagDefsService.ts';
import { ERROR_CODES, TAG_DEFS_BANNER } from '../../shared/index.js';

// ── HTTP server lifecycle ─────────────────────────────────────────────────────

let server;
let base;

beforeAll(async () => {
  const app = createApp();
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}/api/v1`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

function tag(name, data_type, is_setpoint) {
  return {
    template_name: name, template_type: 'tag', children: [],
    fields: {
      data_type:   { field_type: 'TagType', default: data_type },
      is_setpoint: { field_type: 'Boolean', default: is_setpoint },
      Trends:      { field_type: 'Boolean', default: false },
      In_Tag_Name: { field_type: 'Boolean', default: true },
      unit:        { field_type: 'String',  default: 'kW' },
    },
  };
}

function module(name, moduleType, children) {
  return {
    template_name: name, template_type: 'module', children,
    fields: { Module_Type: { field_type: 'ModuleType', default: moduleType } },
  };
}

function loadRootResult(templates) {
  return {
    root_template_name: 'Sys',
    templates: Object.fromEntries(templates.map(t => [t.template_name, { template: t, hash: 'abc123' }])),
  };
}

const SYS_TEMPLATES = [
  tag('numeric_set', 'f32', true),
  tag('numeric_mon', 'f32', false),
  module('RF_Mod', 'MQTT', [
    { template_name: 'numeric_set', asset_name: 'Gain', fields: {} },
    { template_name: 'numeric_mon', asset_name: 'kW',   fields: {} },
  ]),
  module('Pole', 'MQTT', [{ template_name: 'numeric_mon', asset_name: 'Speed', fields: {} }]),
  module('HMI',  'HMI',  [{ template_name: 'numeric_mon', asset_name: 'Tag_Count', fields: {} }]),
  {
    template_name: 'Sys', template_type: 'system', fields: {},
    children: [
      { template_name: 'HMI',    asset_name: 'HMI',   fields: {} },
      { template_name: 'RF_Mod', asset_name: 'RF1',   fields: {} },
      { template_name: 'RF_Mod', asset_name: 'RF2',   fields: {} },
      { template_name: 'Pole',   asset_name: 'Pole1', fields: {} },
    ],
  },
];

async function getJson(path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

// ── GET /api/v1/tag-defs ──────────────────────────────────────────────────────

describe('GET /api/v1/tag-defs', () => {
  it('returns 400 VALIDATION_ERROR when root is missing', async () => {
    const { status, body } = await getJson('/tag-defs');
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(templateService.loadRoot).not.toHaveBeenCalled();
  });

  it('propagates 404 TEMPLATE_NOT_FOUND from loadRoot', async () => {
    const err = Object.assign(new Error('Root template "Nope" not found'), {
      status: 404, code: ERROR_CODES.TEMPLATE_NOT_FOUND,
    });
    templateService.loadRoot.mockRejectedValue(err);
    const { status, body } = await getJson('/tag-defs?root=Nope');
    expect(status).toBe(404);
    expect(body.error.code).toBe(ERROR_CODES.TEMPLATE_NOT_FOUND);
  });

  it('returns a timestamped application/zip attachment', async () => {
    templateService.loadRoot.mockResolvedValue(loadRootResult(SYS_TEMPLATES));
    const res = await fetch(`${base}/tag-defs?root=Sys`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/zip/);
    expect(res.headers.get('content-disposition'))
      .toMatch(/^attachment; filename="TagDefs_\d{4}-\d{2}-\d{2}_\d{6}\.zip"$/);
    expect(templateService.loadRoot).toHaveBeenCalledWith('Sys');
  });

  it('contains one flat JSON per MQTT module template (types, not instances; HMI excluded)', async () => {
    templateService.loadRoot.mockResolvedValue(loadRootResult(SYS_TEMPLATES));
    const res = await fetch(`${base}/tag-defs?root=Sys`);
    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(['Pole.json', 'RF_Mod.json']);
  });

  it('each file carries banner, hash and module-relative tags nested by segment, data_type only', async () => {
    templateService.loadRoot.mockResolvedValue(loadRootResult(SYS_TEMPLATES));
    const res = await fetch(`${base}/tag-defs?root=Sys`);
    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const file = JSON.parse(strFromU8(entries['RF_Mod.json']));
    expect(file._generated).toBe(TAG_DEFS_BANNER);
    expect(file.template_name).toBe('RF_Mod');
    expect(file.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(file.tags).toEqual({
      Gain: { data_type: 'f32' },
      kW:   { data_type: 'f32' },
    });
  });

  it('returns 422 NO_MQTT_MODULES when no MQTT module is reachable', async () => {
    templateService.loadRoot.mockResolvedValue(loadRootResult(SYS_TEMPLATES.filter(t => t.template_type !== 'system' && t.template_name !== 'RF_Mod' && t.template_name !== 'Pole')));
    const { status, body } = await getJson('/tag-defs?root=HMI');
    expect(status).toBe(422);
    expect(body.error.code).toBe(ERROR_CODES.NO_MQTT_MODULES);
  });

  it('returns 422 VALIDATION_ERROR when the graph has a broken reference', async () => {
    const broken = module('RF_Mod', 'MQTT', [{ template_name: 'missing_tag', asset_name: 'X', fields: {} }]);
    templateService.loadRoot.mockResolvedValue(loadRootResult([broken]));
    const { status, body } = await getJson('/tag-defs?root=RF_Mod');
    expect(status).toBe(422);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(body.error.details.some(d => d.code === ERROR_CODES.INVALID_REFERENCE)).toBe(true);
  });
});

describe('GET /api/v1/tag-defs — module-relative names', () => {
  it('returns 422 VALIDATION_ERROR with TAG_NAME_LEAF_AND_GROUP details when a tag name is also a parent', async () => {
    const group = {
      template_name: 'Fwd', template_type: 'Group', children: [{ template_name: 'numeric_mon', asset_name: 'Gain', fields: {} }],
      fields: { In_Tag_Name: { field_type: 'Boolean', default: true } },
    };
    // Hidden grouping (In_Tag_Name false) so the leaf "Fwd" is not a sibling of the group "Fwd".
    const hidden = {
      template_name: 'Hidden', template_type: 'Group', children: [{ template_name: 'numeric_mon', asset_name: 'Fwd', fields: {} }],
      fields: { In_Tag_Name: { field_type: 'Boolean', default: false } },
    };
    const mod = module('RF_Mod', 'MQTT', [
      { template_name: 'Fwd',    asset_name: 'Fwd',    fields: {} },
      { template_name: 'Hidden', asset_name: 'Hidden', fields: {} },
    ]);
    templateService.loadRoot.mockResolvedValue(loadRootResult([tag('numeric_mon', 'f32', false), group, hidden, mod]));
    const { status, body } = await getJson('/tag-defs?root=RF_Mod');
    expect(status).toBe(422);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(body.error.details.map(d => d.code)).toEqual([ERROR_CODES.TAG_NAME_LEAF_AND_GROUP]);
  });

  it('returns 422 VALIDATION_ERROR with DUPLICATE_TAG_NAME details when names collide below the module', async () => {
    const group = {
      template_name: 'Grp', template_type: 'Group', children: [{ template_name: 'numeric_mon', asset_name: 'kW', fields: {} }],
      fields: { In_Tag_Name: { field_type: 'Boolean', default: false } },
    };
    const mod = module('RF_Mod', 'MQTT', [
      { template_name: 'Grp', asset_name: 'A', fields: {} },
      { template_name: 'Grp', asset_name: 'B', fields: {} },
    ]);
    templateService.loadRoot.mockResolvedValue(loadRootResult([tag('numeric_mon', 'f32', false), group, mod]));
    const { status, body } = await getJson('/tag-defs?root=RF_Mod');
    expect(status).toBe(422);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(body.error.details.map(d => d.code)).toEqual([ERROR_CODES.DUPLICATE_TAG_NAME, ERROR_CODES.DUPLICATE_TAG_NAME]);
  });
});

// ── tagDefsZipName ────────────────────────────────────────────────────────────

describe('tagDefsZipName', () => {
  it('formats local time as TagDefs_YYYY-MM-DD_HHmmss.zip with zero padding', () => {
    expect(tagDefsZipName(new Date(2026, 8, 6, 4, 3, 2))).toBe('TagDefs_2026-09-06_040302.zip');
  });
});

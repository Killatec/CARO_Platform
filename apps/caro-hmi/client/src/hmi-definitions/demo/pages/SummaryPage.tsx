/**
 * Summary Page — All Monitors & Interlocks
 *
 * Data-driven: config array maps each parameter to NumericMon + optional BooleanMon (Intk).
 */
import { NumericMon, BooleanMon } from '@caro/widgets';
import {
  PAGE_STYLE,
  HEADING_STYLE,
  MODULES_CONTAINER,
  SECTION_BOX,
  WIDGET_STACK,
} from '../../shared/index.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ParamConfig {
  path: string;
  label: string;
  hasIntk: boolean;
}

interface SectionConfig {
  title: string;
  params: Array<ParamConfig>;
}

// ── Label helper ───────────────────────────────────────────────────────────────

function labelFromPath(path: string): string {
  const segs = path.split('.');
  return segs.slice(-2).join('_');
}

function p(path: string, hasIntk = true): ParamConfig {
  return { path, label: labelFromPath(path), hasIntk };
}

// ── Optics helper ──────────────────────────────────────────────────────────────

const OPTICS_ELEMENTS = [
  'Lens_1', 'Lens_2',
  'Bend_1', 'Bend_2', 'Bend_3', 'Bend_4',
  'Sol_1',  'Sol_2',  'Sol_3',  'Sol_4',
];

function opticsParams(): ParamConfig[] {
  return OPTICS_ELEMENTS.flatMap(el => [
    p(`Optics.${el}.I`),
    p(`Optics.${el}.V`),
  ]);
}

// ── RF Control helper ──────────────────────────────────────────────────────────

const ACC_UNITS = ['Acc_1', 'Acc_2', 'Acc_3', 'Acc_4'];

function rfParams(): ParamConfig[] {
  return [
    p('RF_control.Freq'),
    ...ACC_UNITS.flatMap(acc => [
      p(`RF_control.${acc}.Driver.Fwd`),
      p(`RF_control.${acc}.Driver.Ref`),
      p(`RF_control.${acc}.Kly.Fwd`),
      p(`RF_control.${acc}.Kly.Ref`),
      p(`RF_control.${acc}.Acc.Fwd`),
      p(`RF_control.${acc}.Acc.Ref`),
      p(`RF_control.${acc}.Acc.Phase`),
    ]),
  ];
}

// ── PS helpers ────────────────────────────────────────────────────────────────

function psMainTxParams(ps: string): ParamConfig[] {
  const m = `Power.${ps}.Main_TX`;
  return [
    p(`${m}.AC_Mains.Phase_1_V`),
    p(`${m}.AC_Mains.Phase_2_V`),
    p(`${m}.AC_Mains.Phase_3_V`),
    p(`${m}.AC_Mains.Phase_1_I`),
    p(`${m}.AC_Mains.Phase_2_I`),
    p(`${m}.AC_Mains.Phase_3_I`),
    p(`${m}.DC_Main`),
    p(`${m}.TX_Temp`),
  ];
}

function psHvSwitchParams(ps: string): ParamConfig[] {
  const h = `Power.${ps}.HV_Switch`;
  return [
    p(`${h}.Heater.V`),
    p(`${h}.Heater.I`),
    p(`${h}.Res.V`),
    p(`${h}.Res.I`),
    p(`${h}.Warm_Up`, false),
    p(`${h}.Voltage`),
    p(`${h}.Current`),
  ];
}

function psPulserParams(ps: string): ParamConfig[] {
  const pu = `Power.${ps}.Pulser`;
  return [
    p(`${pu}.HV`),
    p(`${pu}.Primary_I`),
    p(`${pu}.Secondary_I`),
    p(`${pu}.Kly_I`),
    p(`${pu}.Kly_V`),
    p(`${pu}.Oil_Temp`),
  ];
}

function psSections(ps: string): SectionConfig[] {
  return [
    { title: `${ps} — Main TX`,   params: psMainTxParams(ps)   },
    { title: `${ps} — HV Switch`, params: psHvSwitchParams(ps) },
    { title: `${ps} — Pulser`,    params: psPulserParams(ps)   },
  ];
}

// ── Cooling helper ─────────────────────────────────────────────────────────────

function coolingParams(loop: string): ParamConfig[] {
  const base = `Cooling.${loop}`;
  return [
    p(`${base}.Pump.Pressure`),
    p(`${base}.Pump.Flow`),
    p(`${base}.Supply.Pressure`),
    p(`${base}.Supply.Temp`),
    p(`${base}.Return.Pressure`),
    p(`${base}.Return.Temp`),
  ];
}

// ── SECTIONS ──────────────────────────────────────────────────────────────────

const SECTIONS: SectionConfig[] = [
  {
    title: 'Timming',
    params: [p('Timming.Pulse_Rate')],
  },
  {
    title: 'Beam Current',
    params: [
      p('Beam_Current.Gun.Current'),
      p('Beam_Current.Gun.Filament.I'),
      p('Beam_Current.Gun.Filament.V'),
      p('Beam_Current.Gun.Grid_V'),
      p('Beam_Current.Gun.HV.V'),
      p('Beam_Current.Gun.HV.I'),
      p('Beam_Current.Gun.Warm_Up', false),
      p('Beam_Current.Toroid_1'),
      p('Beam_Current.Toroid_2'),
      p('Beam_Current.Average_I'),
      p('Beam_Current.Energy'),
    ],
  },
  {
    title: 'Optics',
    params: opticsParams(),
  },
  {
    title: 'Scanning X',
    params: [
      p('Scanning.X.Min.I'),
      p('Scanning.X.Min.V'),
      p('Scanning.X.Max.I'),
      p('Scanning.X.Max.V'),
      p('Scanning.X.Speed'),
      p('Scanning.X.I_Dev'),
      p('Scanning.X.V_Dev'),
    ],
  },
  {
    title: 'Scanning Y',
    params: [
      p('Scanning.Y.Min.I'),
      p('Scanning.Y.Min.V'),
      p('Scanning.Y.Max.I'),
      p('Scanning.Y.Max.V'),
      p('Scanning.Y.Speed'),
      p('Scanning.Y.I_Dev'),
      p('Scanning.Y.V_Dev'),
    ],
  },
  {
    title: 'RF Control',
    params: rfParams(),
  },
  ...(['PS1', 'PS2', 'PS3', 'PS4'] as const).flatMap(ps => psSections(ps)),
  {
    title: 'Cooling — Facility Loop',
    params: coolingParams('Facility_Loop'),
  },
  {
    title: 'Cooling — Acc Loop',
    params: coolingParams('Acc_Loop'),
  },
];

// ── Chunk helper ──────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], n: number): T[][] {
  const size = Math.ceil(arr.length / n);
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// ── Flattened lists ───────────────────────────────────────────────────────────

const allParams = SECTIONS.flatMap(s => s.params);

const monList  = allParams.map(param => ({ path: param.path, label: param.label }));
const intkList = allParams.filter(param => param.hasIntk).map(param => ({ path: param.path, label: param.label }));

const monChunks  = chunk(monList,  4);
const intkChunks = chunk(intkList, 4);

// ── Page ──────────────────────────────────────────────────────────────────────

export function SummaryPage() {
  return (
    <div style={PAGE_STYLE}>
      <h1 style={HEADING_STYLE}>Summary — All Monitors &amp; Interlocks</h1>
      <div style={MODULES_CONTAINER}>
        {monChunks.map((items, i) => (
          <div key={`mon-${i}`} style={SECTION_BOX}>
            <div style={WIDGET_STACK}>
              {items.map(item => (
                <NumericMon key={item.path} assetPath={`${item.path}.Mon`} label={item.label} />
              ))}
            </div>
          </div>
        ))}
        {intkChunks.map((items, i) => (
          <div key={`intk-${i}`} style={SECTION_BOX}>
            <div style={WIDGET_STACK}>
              {items.map(item => (
                <BooleanMon key={item.path} assetPath={`${item.path}.Intk`} label={`${item.label}_Intk`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

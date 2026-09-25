import { NumericMon, NumericSet, BooleanMon, BooleanSet } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from '../../shared/index.js';

export interface Rf1PowerMonitorBoxProps {
  /** Tag path segment under RF1.Pwr_Mon, e.g. "Mag_1.Fwd", "Comb.Ref". */
  path: string;
  label: string;
}

/**
 * Every RF1.Pwr_Mon.{Mag_1,Mag_2,Comb}.{Fwd,Ref} channel shares this exact
 * 9-field shape — one parameterized box for all six channels rather than
 * six near-duplicate files.
 */
export function Rf1PowerMonitorBox({ path, label }: Rf1PowerMonitorBoxProps) {
  const base = `RF1.Pwr_Mon.${path}`;
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>{label}</h2>
      <div style={WIDGET_STACK}>
        <NumericSet assetPath={`${base}.Gain`} label="Gain" />
        <NumericSet assetPath={`${base}.Offset`} label="Offset" />
        <NumericSet assetPath={`${base}.Att`} label="Att" />
        <NumericSet assetPath={`${base}.Intk_Level`} label="Level" />
        <BooleanSet assetPath={`${base}.Intk_En`} label="Enable" />
        <NumericMon assetPath={`${base}.Raw`} label="Raw" />
        <NumericMon assetPath={`${base}.dBm`} label="dBm" />
        <NumericMon assetPath={`${base}.kW`} label="kW" />
        <BooleanMon assetPath={`${base}.Intk_Status`} label="Intk" />
      </div>
    </div>
  );
}

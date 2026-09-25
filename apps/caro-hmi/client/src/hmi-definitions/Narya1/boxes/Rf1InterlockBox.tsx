import { BooleanMon, BooleanSet } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from '../../shared/index.js';

export interface Rf1InterlockBoxProps {
  /** Tag path segment under RF1.Dig_Intks, e.g. "Amtek_Intk", "Spec_Intk". */
  path: string;
  label: string;
}

/**
 * Every RF1.Dig_Intks.* interlock (Amtek_Intk, HPS_WD_Intk, SC_Status_Intk,
 * Spec_Intk) shares this exact 5-field shape — one parameterized box.
 */
export function Rf1InterlockBox({ path, label }: Rf1InterlockBoxProps) {
  const base = `RF1.Dig_Intks.${path}`;
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>{label}</h2>
      <div style={WIDGET_STACK}>
        <BooleanMon assetPath={`${base}.Mon`} label="Mon" />
        <BooleanSet assetPath={`${base}.INE_Set`} label="INE Set" />
        <BooleanMon assetPath={`${base}.INE_Mon`} label="INE Mon" />
        <BooleanMon assetPath={`${base}.Intk`} label="Intk" />
        <BooleanSet assetPath={`${base}.Test`} label="Test" />
      </div>
    </div>
  );
}

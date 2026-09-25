import { NumericMon, NumericSet, BooleanSet } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from '../../shared/index.js';

export function Rf1PowerPidBox() {
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>RF1 Power PID</h2>
      <div style={WIDGET_STACK}>
        <BooleanSet assetPath="RF1.Phase.PhPower.PID.Enable" label="Power PID Enable" />
        <NumericSet assetPath="RF1.Phase.PhPower.PID.KP" label="Power KP" />
        <NumericSet assetPath="RF1.Phase.PhPower.PID.KI1" label="Power KI1" />
        <NumericSet assetPath="RF1.Phase.PhPower.PID.KI2" label="Power KI2" />
        <NumericSet assetPath="RF1.Phase.PhPower.PID.KD" label="Power KD" />
        <NumericSet assetPath="RF1.Phase.PhPower.PID.D_Fil" label="Power D Fil" />
        <NumericSet assetPath="RF1.Phase.PhPower.SIM_A" label="Pwr SIM A" />
        <NumericSet assetPath="RF1.Phase.PhPower.SIM_B" label="Pwr SIM B" />
        <NumericSet assetPath="RF1.Phase.PhPower.Power_Set_1" label="Power Set 1" />
        <NumericSet assetPath="RF1.Phase.PhPower.Power_Set_2" label="Power Set 2" />
        <NumericMon assetPath="RF1.Phase.PhPower.Power.Mon" label="Power Mon" />
      </div>
    </div>
  );
}

import { NumericMon, NumericSet, BooleanSet } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from '../../shared/index.js';

export function Rf1PhasePidBox() {
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>RF1 Phase PID</h2>
      <div style={WIDGET_STACK}>
        <BooleanSet assetPath="RF1.Phase.PID.Enable" label="Phase PID Enable" />
        <NumericSet assetPath="RF1.Phase.Shifter_Set" label="Shifter Set" />
        <NumericSet assetPath="RF1.Phase.PID.KP" label="Phase KP" />
        <NumericSet assetPath="RF1.Phase.PID.KI" label="Phase KI" />
        <NumericSet assetPath="RF1.Phase.PID.KD" label="Phase KD" />
        <NumericSet assetPath="RF1.Phase.PID.KFF" label="Phase KFF" />
        <NumericSet assetPath="RF1.Phase.PID.Mon_Delay" label="Phase Mon Delay" />
        <NumericSet assetPath="RF1.Phase.PID.Step_Mask" label="Phase Step Mask" />
        <NumericMon assetPath="RF1.Phase.PID.Phase_Error" label="Phase Error" />
        <NumericMon assetPath="RF1.Phase.Shifter_CMD" label="Shifter CMD" />
        <NumericSet assetPath="RF1.Phase.Set_1" label="Phase Set 1" />
        <NumericSet assetPath="RF1.Phase.Set_2" label="Phase Set 2" />
      </div>
    </div>
  );
}

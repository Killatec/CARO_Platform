import { AnalogIn, BooleanSet, Timer } from '@caro/widgets';
import { SECTION_BOX, MODULE_TITLE, ANALOG_IN_STACK } from './styles.js';

export function PSHvSwitchBox({ ps }: { ps: string }) {
  return (
    <div style={SECTION_BOX}>
      <h2 style={MODULE_TITLE}>{ps} — HV Switch</h2>
      <div style={ANALOG_IN_STACK}>
        <BooleanSet assetPath={`Power.${ps}.HV_Switch.Enable`} label="HV_Enable" />
        <BooleanSet assetPath={`Power.${ps}.HV_Switch.Heater.Enable`} label="Heater_Enable" />
        <AnalogIn assetPath={`Power.${ps}.HV_Switch.Heater.V`} label="Heater_V" showHeader={true} />
        <AnalogIn assetPath={`Power.${ps}.HV_Switch.Heater.I`} label="Heater_I" />
        <BooleanSet assetPath={`Power.${ps}.HV_Switch.Res.Enable`} label="Res_Enable" />
        <AnalogIn assetPath={`Power.${ps}.HV_Switch.Res.V`} label="Res_V" />
        <AnalogIn assetPath={`Power.${ps}.HV_Switch.Res.I`} label="Res_I" />
        <Timer assetPath={`Power.${ps}.HV_Switch.Warm_Up`} label="Warm_Up" showHeader={true} />
        <AnalogIn assetPath={`Power.${ps}.HV_Switch.Voltage`} label="Voltage" />
        <AnalogIn assetPath={`Power.${ps}.HV_Switch.Current`} label="Current" />
      </div>
    </div>
  );
}

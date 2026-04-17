import { AnalogIn, BooleanSet, Timer } from '@caro/widgets';
import { SECTION_BOX, MODULE_TITLE, ANALOG_IN_STACK } from './styles.js';

export function GunBox() {
  return (
    <div style={SECTION_BOX}>
      <h2 style={MODULE_TITLE}>Gun</h2>
      <div style={ANALOG_IN_STACK}>
        <BooleanSet assetPath="Gun.Filament.Enable" label="Filament_Enable" />
        <BooleanSet assetPath="Gun.HV.Enable" label="HV_Enable" />
        <Timer assetPath="Gun.Warm_Up" label="Warm_Up" showHeader={true} />
        <AnalogIn assetPath="Gun.Current" label="Current" showHeader={true} />
        <AnalogIn assetPath="Gun.Grid_V" label="Grid_V" />
        <AnalogIn assetPath="Gun.Filament.I" label="Filament_I" />
        <AnalogIn assetPath="Gun.Filament.V" label="Filament_V" />
        <AnalogIn assetPath="Gun.HV.V" label="HV_V" />
        <AnalogIn assetPath="Gun.HV.I" label="HV_I" />
      </div>
    </div>
  );
}

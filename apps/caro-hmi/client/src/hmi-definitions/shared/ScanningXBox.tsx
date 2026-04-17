import { AnalogIn, BooleanSet } from '@caro/widgets';
import { SECTION_BOX, MODULE_TITLE, ANALOG_IN_STACK } from './styles.js';

export function ScanningXBox() {
  return (
    <div style={SECTION_BOX}>
      <h2 style={MODULE_TITLE}>Scanning X</h2>
      <div style={ANALOG_IN_STACK}>
        <BooleanSet assetPath="Scanning.X.Enable" label="Enable" />
        <BooleanSet assetPath="Scanning.X.Min.Enable" label="Min_Enable" />
        <AnalogIn assetPath="Scanning.X.Min.I" label="Min_I" showHeader={true} />
        <AnalogIn assetPath="Scanning.X.Min.V" label="Min_V" />
        <BooleanSet assetPath="Scanning.X.Max.Enable" label="Max_Enable" />
        <AnalogIn assetPath="Scanning.X.Max.I" label="Max_I" />
        <AnalogIn assetPath="Scanning.X.Max.V" label="Max_V" />
        <AnalogIn assetPath="Scanning.X.Speed" label="Speed" />
        <AnalogIn assetPath="Scanning.X.I_Dev" label="I_Dev" />
        <AnalogIn assetPath="Scanning.X.V_Dev" label="V_Dev" />
      </div>
    </div>
  );
}

import { AnalogIn, BooleanSet } from '@caro/widgets';
import { SECTION_BOX, MODULE_TITLE, ANALOG_IN_STACK } from './styles.js';

export function ScanningYBox() {
  return (
    <div style={SECTION_BOX}>
      <h2 style={MODULE_TITLE}>Scanning Y</h2>
      <div style={ANALOG_IN_STACK}>
        <BooleanSet assetPath="Scanning.Y.Enable" label="Enable" />
        <BooleanSet assetPath="Scanning.Y.Min.Enable" label="Min_Enable" />
        <AnalogIn assetPath="Scanning.Y.Min.I" label="Min_I" showHeader={true} />
        <AnalogIn assetPath="Scanning.Y.Min.V" label="Min_V" />
        <BooleanSet assetPath="Scanning.Y.Max.Enable" label="Max_Enable" />
        <AnalogIn assetPath="Scanning.Y.Max.I" label="Max_I" />
        <AnalogIn assetPath="Scanning.Y.Max.V" label="Max_V" />
        <AnalogIn assetPath="Scanning.Y.Speed" label="Speed" />
        <AnalogIn assetPath="Scanning.Y.I_Dev" label="I_Dev" />
        <AnalogIn assetPath="Scanning.Y.V_Dev" label="V_Dev" />
      </div>
    </div>
  );
}

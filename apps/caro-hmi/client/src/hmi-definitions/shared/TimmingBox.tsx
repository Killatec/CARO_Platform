import { AnalogIn, NumericSet } from '@caro/widgets';
import { SECTION_BOX, MODULE_TITLE, ANALOG_IN_STACK } from './styles.js';

export function TimmingBox() {
  return (
    <div style={SECTION_BOX}>
      <h2 style={MODULE_TITLE}>Timming</h2>
      <div style={ANALOG_IN_STACK}>
        <AnalogIn assetPath="Timming.Pulse_Rate" label="Pulse_Rate" showHeader={true} />
        <NumericSet assetPath="Timming.Discharge_Delay" label="Discharge_Delay" />
        <NumericSet assetPath="Timming.Sample_Delay" label="Sample_Delay" />
      </div>
    </div>
  );
}

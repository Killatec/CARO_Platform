import { AnalogIn, BooleanSet } from '@caro/widgets';
import { SECTION_BOX, MODULE_TITLE, ANALOG_IN_STACK } from './styles.js';

export function RfOverviewBox() {
  return (
    <div style={SECTION_BOX}>
      <h2 style={MODULE_TITLE}>RF Overview</h2>
      <div style={ANALOG_IN_STACK}>
        <AnalogIn assetPath="RF_control.Freq" label="Freq" showHeader={true} />
        <BooleanSet assetPath="RF_control.Auto" label="Auto" />
      </div>
    </div>
  );
}

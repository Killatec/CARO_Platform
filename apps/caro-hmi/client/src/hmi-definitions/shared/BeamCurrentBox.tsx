import { AnalogIn } from '@caro/widgets';
import { SECTION_BOX, MODULE_TITLE, ANALOG_IN_STACK } from './styles.js';

export function BeamCurrentBox() {
  return (
    <div style={SECTION_BOX}>
      <h2 style={MODULE_TITLE}>Beam Current</h2>
      <div style={ANALOG_IN_STACK}>
        <AnalogIn assetPath="Beam_Current.Average_I" label="Beam_Current" showHeader={true} />
        <AnalogIn assetPath="Beam_Current.Energy" label="Beam_Energy" />
        <AnalogIn assetPath="Beam_Current.Toroid_1" label="Toroid_1" />
        <AnalogIn assetPath="Beam_Current.Toroid_2" label="Toroid_2" />
      </div>
    </div>
  );
}

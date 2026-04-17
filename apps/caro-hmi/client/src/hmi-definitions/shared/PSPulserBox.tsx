import { AnalogIn } from '@caro/widgets';
import { SECTION_BOX, MODULE_TITLE, ANALOG_IN_STACK } from './styles.js';

export function PSPulserBox({ ps }: { ps: string }) {
  return (
    <div style={SECTION_BOX}>
      <h2 style={MODULE_TITLE}>{ps} — Pulser</h2>
      <div style={ANALOG_IN_STACK}>
        <AnalogIn assetPath={`Power.${ps}.Pulser.HV`} label="HV" showHeader={true} />
        <AnalogIn assetPath={`Power.${ps}.Pulser.Primary_I`} label="Primary_I" />
        <AnalogIn assetPath={`Power.${ps}.Pulser.Secondary_I`} label="Secondary_I" />
        <AnalogIn assetPath={`Power.${ps}.Pulser.Kly_I`} label="Kly_I" />
        <AnalogIn assetPath={`Power.${ps}.Pulser.Kly_V`} label="Kly_V" />
        <AnalogIn assetPath={`Power.${ps}.Pulser.Oil_Temp`} label="Oil_Temp" />
      </div>
    </div>
  );
}

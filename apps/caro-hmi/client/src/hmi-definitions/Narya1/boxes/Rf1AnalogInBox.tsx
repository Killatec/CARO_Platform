import { AnalogIn } from '@caro/widgets';
import { SECTION_BOX, MODULE_TITLE, ANALOG_IN_STACK } from '../../shared/index.js';

/**
 * RF1's five Analog In groups, each with the nine AnalogIn children
 * (Set, Mon, Tol, By, Intk, RSS, Per, In_A, In_B) — one row per group.
 */
export function Rf1AnalogInBox() {
  return (
    <div style={SECTION_BOX}>
      <h2 style={MODULE_TITLE}>RF1 Analog In</h2>
      <div style={ANALOG_IN_STACK}>
        <AnalogIn assetPath="RF1.Source.Freq" label="Source Freq" showHeader={true} />
        <AnalogIn assetPath="RF1.Pulse.Freq" label="Pulse Freq" />
        <AnalogIn assetPath="RF1.Pulse.Width" label="Pulse Width" />
        <AnalogIn assetPath="RF1.Phase.Phase" label="Phase" />
        <AnalogIn assetPath="RF1.Phase.PhPower.Power" label="Power" />
      </div>
    </div>
  );
}

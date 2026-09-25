import { NumericMon, NumericSet, BooleanSet } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from '../../shared/index.js';

export function Rf1PulseBox() {
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>RF1 Pulse</h2>
      <div style={WIDGET_STACK}>
        <BooleanSet assetPath="RF1.Pulse.Enable" label="Pulse Enable" />
        <NumericSet assetPath="RF1.Pulse.Freq.Set" label="Freq Set" />
        <NumericSet assetPath="RF1.Pulse.Width.Set" label="Width Set" />
        <NumericSet assetPath="RF1.Pulse.Freq.RSS" label="Freq RSS" />
        <NumericSet assetPath="RF1.Pulse.Width.RSS" label="Width RSS" />
        <NumericMon assetPath="RF1.Pulse.Freq.Mon" label="Freq Mon" />
        <NumericMon assetPath="RF1.Pulse.Width.Mon" label="Width Mon" />
      </div>
    </div>
  );
}

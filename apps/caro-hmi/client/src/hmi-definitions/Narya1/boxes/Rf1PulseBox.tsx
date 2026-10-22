import { BooleanSet } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from '../../shared/index.js';

export function Rf1PulseBox() {
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>RF1 Pulse</h2>
      <div style={WIDGET_STACK}>
        <BooleanSet assetPath="RF1.Pulse.Enable" label="Pulse Enable" />
      </div>
    </div>
  );
}

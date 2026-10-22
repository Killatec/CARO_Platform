import { NumericMon, NumericSet } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from '../../shared/index.js';

/**
 * The reference UI plots RF1.Phase.Phase_XY.{X,Y} as a live X-Y scatter
 * point. No widget for that exists yet in @caro/widgets (see
 * Docs/platform/platform_todo.md) — the raw values render as numeric fields below
 * until it does.
 */
export function Rf1PhaseXYBox() {
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>RF1 Phase X-Y</h2>
      <div style={WIDGET_STACK}>
        <NumericSet assetPath="RF1.Phase.X_Offset" label="Phase X Offset" />
        <NumericSet assetPath="RF1.Phase.Y_Offset" label="Phase Y Offset" />
        <NumericSet assetPath="RF1.Phase.Filter_K" label="Phase Filter K" />
        <NumericMon assetPath="RF1.Phase.Phase_XY.X" label="Phase X" />
        <NumericMon assetPath="RF1.Phase.Phase_XY.Y" label="Phase Y" />
        <NumericMon assetPath="RF1.Phase.Spread" label="Phase Spread" />
      </div>
    </div>
  );
}

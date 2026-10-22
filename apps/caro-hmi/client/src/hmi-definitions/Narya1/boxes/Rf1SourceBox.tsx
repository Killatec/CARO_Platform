import { NumericSet, BooleanMon, BooleanSet } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from '../../shared/index.js';

export function Rf1SourceBox() {
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>RF1 Source</h2>
      <div style={WIDGET_STACK}>
        <NumericSet assetPath="RF1.Source.PLL_Mux_Out" label="PLL Mux Out" />
        <BooleanSet assetPath="RF1.Source.RF_Enable" label="RF Enable" />
        <BooleanMon assetPath="RF1.Dig_Mons.All_Intks_Ok" label="All Intks Ok" />
        <BooleanMon assetPath="RF1.Dig_Mons.Intks_Active" label="Intks Active" />
      </div>
    </div>
  );
}

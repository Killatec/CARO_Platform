import { NumericSet, BooleanMon, BooleanSet } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from '../../shared/index.js';

export function Rf1DigitalIOBox() {
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>RF1 Digital I/O</h2>
      <div style={WIDGET_STACK}>
        <NumericSet assetPath="RF1.Pwr_Mon.Intk_Mask_Delay" label="Intk Mask Delay" />
        <NumericSet assetPath="RF1.Pwr_Mon.Pwr_Filter_K" label="Pwr Filter K" />
        <BooleanSet assetPath="RF1.Dig_Sets.Test_Digital" label="Test Digital" />
        <BooleanSet assetPath="RF1.Dig_Sets.Force_WatchDog" label="Force WatchDog" />
        <BooleanSet assetPath="RF1.Dig_Sets.Force_SCR" label="Force SCR" />
        <BooleanSet assetPath="RF1.Dig_Sets.Amp_Intk" label="Amp Intk" />
        <BooleanSet assetPath="RF1.Dig_Sets.COM_1_TX" label="COM 1 TX" />
        <BooleanSet assetPath="RF1.Dig_Sets.COM_2_TX" label="COM 2 TX" />
        <BooleanMon assetPath="RF1.Dig_Mons.Spare_DI" label="Spare DI" />
        <BooleanMon assetPath="RF1.Dig_Mons.COM_1_RX" label="COM 1 RX" />
        <BooleanMon assetPath="RF1.Dig_Mons.COM_2_RX" label="COM 2 RX" />
        <BooleanMon assetPath="RF1.Dig_Mons.SCR_Enable" label="SCR Enable" />
        <BooleanMon assetPath="RF1.Dig_Mons.Remote_Start" label="Remote Start" />
        <BooleanMon assetPath="RF1.Dig_Mons.Remote_Stop" label="Remote Stop" />
        <BooleanMon assetPath="RF1.Dig_Mons.SC_Status" label="SC Status" />
        <BooleanMon assetPath="RF1.Dig_Mons.SC_Mag_1_On" label="SC Mag 1 On" />
        <BooleanMon assetPath="RF1.Dig_Mons.SC_Mag_2_On" label="SC Mag 2 On" />
      </div>
    </div>
  );
}

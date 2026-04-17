import { AnalogIn, BooleanSet } from '@caro/widgets';
import { SECTION_BOX, MODULE_TITLE, ANALOG_IN_STACK } from './styles.js';

export function PSMainTxBox({ ps }: { ps: string }) {
  return (
    <div style={SECTION_BOX}>
      <h2 style={MODULE_TITLE}>{ps} — Main TX</h2>
      <div style={ANALOG_IN_STACK}>
        <BooleanSet assetPath={`Power.${ps}.Enable`} label="PS_Enable" />
        <AnalogIn assetPath={`Power.${ps}.Main_TX.AC_Mains.Phase_1_V`} label="Phase_1_V" showHeader={true} />
        <AnalogIn assetPath={`Power.${ps}.Main_TX.AC_Mains.Phase_2_V`} label="Phase_2_V" />
        <AnalogIn assetPath={`Power.${ps}.Main_TX.AC_Mains.Phase_3_V`} label="Phase_3_V" />
        <AnalogIn assetPath={`Power.${ps}.Main_TX.AC_Mains.Phase_1_I`} label="Phase_1_I" />
        <AnalogIn assetPath={`Power.${ps}.Main_TX.AC_Mains.Phase_2_I`} label="Phase_2_I" />
        <AnalogIn assetPath={`Power.${ps}.Main_TX.AC_Mains.Phase_3_I`} label="Phase_3_I" />
        <AnalogIn assetPath={`Power.${ps}.Main_TX.DC_Main`} label="DC_Main" />
        <AnalogIn assetPath={`Power.${ps}.Main_TX.TX_Temp`} label="TX_Temp" />
      </div>
    </div>
  );
}

import { AnalogIn, BooleanSet } from '@caro/widgets';
import { SECTION_BOX, MODULE_TITLE, ANALOG_IN_STACK } from './styles.js';

export function CoolingLoopBox({ loop }: { loop: string }) {
  return (
    <div style={SECTION_BOX}>
      <h2 style={MODULE_TITLE}>{loop}</h2>
      <div style={ANALOG_IN_STACK}>
        <BooleanSet assetPath={`Cooling.${loop}.Pump.Enable`} label="Pump_Enable" />
        <AnalogIn assetPath={`Cooling.${loop}.Pump.Pressure`} label="Pump_Pressure" showHeader={true} />
        <AnalogIn assetPath={`Cooling.${loop}.Pump.Flow`} label="Pump_Flow" />
        <AnalogIn assetPath={`Cooling.${loop}.Supply.Pressure`} label="Supply_Pressure" />
        <AnalogIn assetPath={`Cooling.${loop}.Supply.Temp`} label="Supply_Temp" />
        <AnalogIn assetPath={`Cooling.${loop}.Return.Pressure`} label="Return_Pressure" />
        <AnalogIn assetPath={`Cooling.${loop}.Return.Temp`} label="Return_Temp" />
      </div>
    </div>
  );
}

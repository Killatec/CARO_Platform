import { AnalogIn, BooleanSet } from '@caro/widgets';
import { SECTION_BOX, MODULE_TITLE, ANALOG_IN_STACK } from './styles.js';

export function AccBox({ acc }: { acc: string }) {
  return (
    <div style={SECTION_BOX}>
      <h2 style={MODULE_TITLE}>{acc}</h2>
      <div style={ANALOG_IN_STACK}>
        <AnalogIn assetPath={`RF_control.${acc}.Driver.Fwd`} label="Driver_Fwd" showHeader={true} />
        <AnalogIn assetPath={`RF_control.${acc}.Driver.Ref`} label="Driver_Ref" />
        <AnalogIn assetPath={`RF_control.${acc}.Kly.Fwd`} label="Kly_Fwd" />
        <AnalogIn assetPath={`RF_control.${acc}.Kly.Ref`} label="Kly_Ref" />
        <BooleanSet assetPath={`RF_control.${acc}.Acc.Auto`} label="Acc_Auto" />
        <AnalogIn assetPath={`RF_control.${acc}.Acc.Fwd`} label="Acc_Fwd" />
        <AnalogIn assetPath={`RF_control.${acc}.Acc.Ref`} label="Acc_Ref" />
        <AnalogIn assetPath={`RF_control.${acc}.Acc.Phase`} label="Acc_Phase" />
      </div>
    </div>
  );
}

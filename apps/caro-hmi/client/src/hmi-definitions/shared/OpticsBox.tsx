import { AnalogIn, BooleanSet } from '@caro/widgets';
import { SECTION_BOX, MODULE_TITLE, ANALOG_IN_STACK } from './styles.js';

export function OpticsBox() {
  return (
    <div style={SECTION_BOX}>
      <h2 style={MODULE_TITLE}>Optics</h2>
      <div style={ANALOG_IN_STACK}>
        <BooleanSet assetPath="Optics.Lens_1.Enable" label="Lens_1_Enable" />
        <AnalogIn assetPath="Optics.Lens_1.I" label="Lens_1_I" showHeader={true} />
        <AnalogIn assetPath="Optics.Lens_1.V" label="Lens_1_V" />
        <BooleanSet assetPath="Optics.Lens_2.Enable" label="Lens_2_Enable" />
        <AnalogIn assetPath="Optics.Lens_2.I" label="Lens_2_I" />
        <AnalogIn assetPath="Optics.Lens_2.V" label="Lens_2_V" />
        <BooleanSet assetPath="Optics.Bend_1.Enable" label="Bend_1_Enable" />
        <AnalogIn assetPath="Optics.Bend_1.I" label="Bend_1_I" />
        <AnalogIn assetPath="Optics.Bend_1.V" label="Bend_1_V" />
        <BooleanSet assetPath="Optics.Bend_2.Enable" label="Bend_2_Enable" />
        <AnalogIn assetPath="Optics.Bend_2.I" label="Bend_2_I" />
        <AnalogIn assetPath="Optics.Bend_2.V" label="Bend_2_V" />
        <BooleanSet assetPath="Optics.Bend_3.Enable" label="Bend_3_Enable" />
        <AnalogIn assetPath="Optics.Bend_3.I" label="Bend_3_I" />
        <AnalogIn assetPath="Optics.Bend_3.V" label="Bend_3_V" />
        <BooleanSet assetPath="Optics.Bend_4.Enable" label="Bend_4_Enable" />
        <AnalogIn assetPath="Optics.Bend_4.I" label="Bend_4_I" />
        <AnalogIn assetPath="Optics.Bend_4.V" label="Bend_4_V" />
        <BooleanSet assetPath="Optics.Sol_1.Enable" label="Sol_1_Enable" />
        <AnalogIn assetPath="Optics.Sol_1.I" label="Sol_1_I" />
        <AnalogIn assetPath="Optics.Sol_1.V" label="Sol_1_V" />
        <BooleanSet assetPath="Optics.Sol_2.Enable" label="Sol_2_Enable" />
        <AnalogIn assetPath="Optics.Sol_2.I" label="Sol_2_I" />
        <AnalogIn assetPath="Optics.Sol_2.V" label="Sol_2_V" />
        <BooleanSet assetPath="Optics.Sol_3.Enable" label="Sol_3_Enable" />
        <AnalogIn assetPath="Optics.Sol_3.I" label="Sol_3_I" />
        <AnalogIn assetPath="Optics.Sol_3.V" label="Sol_3_V" />
        <BooleanSet assetPath="Optics.Sol_4.Enable" label="Sol_4_Enable" />
        <AnalogIn assetPath="Optics.Sol_4.I" label="Sol_4_I" />
        <AnalogIn assetPath="Optics.Sol_4.V" label="Sol_4_V" />
      </div>
    </div>
  );
}

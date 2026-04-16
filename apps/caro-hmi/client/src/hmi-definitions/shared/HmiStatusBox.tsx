import { NumericMon } from '@caro/widgets';
import { STATUS_BOX, MODULE_TITLE, WIDGET_STACK } from './styles.js';

export function HmiStatusBox() {
  return (
    <div style={STATUS_BOX}>
      <h2 style={MODULE_TITLE}>HMI Status</h2>
      <div style={WIDGET_STACK}>
        <NumericMon assetPath="HMI.Module_Count" label="Module Count" />
        <NumericMon assetPath="HMI.Tag_Count" label="Tag Count" />
        <NumericMon assetPath="HMI.Telemetry_CPU" label="Telemetry_CPU" />
        <NumericMon assetPath="HMI.Reset_Count" label="Reset Count" />
      </div>
    </div>
  );
}

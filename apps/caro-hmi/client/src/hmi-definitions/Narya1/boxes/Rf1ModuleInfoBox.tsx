import { NumericMon, BooleanMon, StringMon } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from '../../shared/index.js';

export function Rf1ModuleInfoBox() {
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>RF1 Module Info</h2>
      <div style={WIDGET_STACK}>
        <StringMon assetPath="RF1.Module_Info.Firmware" label="Firmware" />
        <StringMon assetPath="RF1.Module_Info.IP" label="IP" />
        <StringMon assetPath="RF1.Module_Info.Status" label="Status" />
        <BooleanMon assetPath="RF1.Module_Info.Ready" label="Ready" />
        <NumericMon assetPath="RF1.Module_Info.Set_CRC" label="Set CRC" />
        <BooleanMon assetPath="RF1.Module_Info.Sets_Ok" label="Sets Ok" />
        <NumericMon assetPath="RF1.Module_Info.Time" label="Time" />
      </div>
    </div>
  );
}

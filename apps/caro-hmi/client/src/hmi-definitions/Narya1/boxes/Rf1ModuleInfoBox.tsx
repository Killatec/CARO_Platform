import { NumericMon, BooleanMon } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from '../../shared/index.js';

/**
 * RF1.Module_Info.IP and .Status are String-type tags. NumericMon calls
 * value.toFixed() internally and would throw on a string value, so they're
 * omitted here pending a string-display widget (no dedicated one exists in
 * @caro/widgets yet — see Docs/platform_todo.md).
 */
export function Rf1ModuleInfoBox() {
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>RF1 Module Info</h2>
      <div style={WIDGET_STACK}>
        <NumericMon assetPath="RF1.Module_Info.Firmware" label="Firmware" />
        <NumericMon assetPath="RF1.Module_Info.Set_CRC" label="Set CRC" />
        <BooleanMon assetPath="RF1.Module_Info.Sets_Ok" label="Sets Ok" />
        <NumericMon assetPath="RF1.Module_Info.Time" label="Time" />
      </div>
    </div>
  );
}

/**
 * Demo Power Page
 */
import {
  PAGE_STYLE,
  HEADING_STYLE,
  MODULES_CONTAINER,
  PSMainTxBox,
  PSHvSwitchBox,
  PSPulserBox,
} from '../../shared/index.js';

export function PowerPage() {
  return (
    <div style={PAGE_STYLE}>
      <h1 style={HEADING_STYLE}>Power</h1>
      <div style={MODULES_CONTAINER}>
        <PSMainTxBox ps="PS1" />
        <PSHvSwitchBox ps="PS1" />
        <PSPulserBox ps="PS1" />
        <PSMainTxBox ps="PS2" />
        <PSHvSwitchBox ps="PS2" />
        <PSPulserBox ps="PS2" />
        <PSMainTxBox ps="PS3" />
        <PSHvSwitchBox ps="PS3" />
        <PSPulserBox ps="PS3" />
        <PSMainTxBox ps="PS4" />
        <PSHvSwitchBox ps="PS4" />
        <PSPulserBox ps="PS4" />
      </div>
    </div>
  );
}

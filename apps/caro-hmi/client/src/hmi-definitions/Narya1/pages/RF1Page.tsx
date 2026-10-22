/**
 * Narya1 RF1 Page
 *
 * Covers the reference "RF Control" / "RF Phase" / "RF SpecA" pages on one
 * consolidated page, built with the widgets that exist today. Three pieces
 * of the reference UI are deferred pending new @caro/widgets components
 * (tracked in Docs/platform/platform_todo.md) and are NOT rendered here:
 *   1. The Phase X-Y scatter plot (RF1.Phase.Phase_XY.{X,Y} render as plain
 *      numeric fields in Rf1PhaseXYBox instead).
 *   2. The frequency-mapped (MHz-axis) spectrum chart (Rf1SpecABox uses the
 *      existing bin-index SpectrumChart as an interim approximation).
 *   3. Label-lookup rendering for An_Display/Dig_Display (Rf1DisplayBox
 *      renders their raw Int16 values instead of resolved text labels).
 * Also omitted: Close_App/Reboot command buttons (RF1's actual cmd_str
 * contract isn't confirmed).
 */
import { PAGE_STYLE, HEADING_STYLE, MODULES_CONTAINER } from '../../shared/index.js';
import {
  Rf1SourceBox,
  Rf1AnalogInBox,
  Rf1PowerMonitorBox,
  Rf1InterlockBox,
  Rf1DigitalIOBox,
  Rf1DisplayBox,
  Rf1ModuleInfoBox,
  Rf1PulseBox,
  Rf1PhaseXYBox,
  Rf1PhasePidBox,
  Rf1PowerPidBox,
  Rf1SpecABox,
} from '../boxes/index.js';

export function RF1Page() {
  return (
    <div style={PAGE_STYLE}>
      <h1 style={HEADING_STYLE}>RF1</h1>
      <div style={MODULES_CONTAINER}>
        <Rf1SourceBox />
        <Rf1AnalogInBox />
        <Rf1PowerMonitorBox path="Mag_1.Fwd" label="Mag 1 Fwd" />
        <Rf1PowerMonitorBox path="Mag_1.Ref" label="Mag 1 Ref" />
        <Rf1PowerMonitorBox path="Mag_2.Fwd" label="Mag 2 Fwd" />
        <Rf1PowerMonitorBox path="Mag_2.Ref" label="Mag 2 Ref" />
        <Rf1PowerMonitorBox path="Comb.Fwd" label="Comb Fwd" />
        <Rf1PowerMonitorBox path="Comb.Ref" label="Comb Ref" />
        <Rf1InterlockBox path="Amtek_Intk" label="Amtek Intk" />
        <Rf1InterlockBox path="HPS_WD_Intk" label="HPS WD Intk" />
        <Rf1InterlockBox path="SC_Status_Intk" label="SC Status Intk" />
        <Rf1InterlockBox path="Spec_Intk" label="Spec Intk" />
        <Rf1DigitalIOBox />
        <Rf1DisplayBox />
        <Rf1ModuleInfoBox />
        <Rf1PulseBox />
        <Rf1PhaseXYBox />
        <Rf1PhasePidBox />
        <Rf1PowerPidBox />
        <Rf1SpecABox />
      </div>
    </div>
  );
}

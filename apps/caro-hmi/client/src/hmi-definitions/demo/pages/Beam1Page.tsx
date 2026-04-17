/**
 * Demo Beam 1 Page
 */
import {
  PAGE_STYLE,
  HEADING_STYLE,
  MODULES_CONTAINER,
  BeamCurrentBox,
  GunBox,
  TimmingBox,
  OpticsBox,
  ScanningXBox,
  ScanningYBox,
} from '../../shared/index.js';

export function Beam1Page() {
  return (
    <div style={PAGE_STYLE}>
      <h1 style={HEADING_STYLE}>Beam 1</h1>
      <div style={MODULES_CONTAINER}>
        <BeamCurrentBox />
        <GunBox />
        <TimmingBox />
        <OpticsBox />
        <ScanningXBox />
        <ScanningYBox />
      </div>
    </div>
  );
}

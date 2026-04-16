/**
 * Demo Overview Page
 *
 * Two RF module boxes displayed side-by-side (responsive).
 * Each box: reset count → setpoints → monitors → interlock enable → interlock status
 */
import { AnalogIn } from '@caro/widgets';
import {
  RfModuleBox,
  HmiStatusBox,
  ModuleStatusBox,
  PAGE_STYLE,
  HEADING_STYLE,
  MODULES_CONTAINER,
  MODULE_TITLE,
  SECTION_BOX,
  ANALOG_IN_STACK,
} from '../../shared/index.js';

export function OverviewPage() {
  return (
    <div style={PAGE_STYLE}>
      <h1 style={HEADING_STYLE}>System Overview — Live Telemetry</h1>
      <div style={MODULES_CONTAINER}>
        <div style={{ flexBasis: '100%', display: 'flex' }}>
          <HmiStatusBox />
        </div>
        <div style={{ flexBasis: '100%', display: 'flex' }}>
          <ModuleStatusBox />
        </div>
        {(['RF1', 'RF2'] as const).map(m => (
          <RfModuleBox key={m} module={m} />
        ))}

        {/* Analog Inputs — stacked alignment demo */}
        <div>
          <div style={SECTION_BOX}>
            <h2 style={MODULE_TITLE}>Analog Inputs</h2>
            <div style={ANALOG_IN_STACK}>
              <AnalogIn assetPath="RF1.PRF" label="PRF" showHeader={true} />
              <AnalogIn assetPath="RF2.PRF" label="PRF" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

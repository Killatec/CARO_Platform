/**
 * Demo Overview Page
 *
 * HMI status and module status boxes.
 */
import {
  HmiStatusBox,
  TrendStatusBox,
  ModuleStatusBox,
  PAGE_STYLE,
  HEADING_STYLE,
  MODULES_CONTAINER,
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
          <TrendStatusBox />
        </div>
        <div style={{ flexBasis: '100%', display: 'flex' }}>
          <ModuleStatusBox />
        </div>
      </div>
    </div>
  );
}

/**
 * Demo Cooling Page
 */
import {
  PAGE_STYLE,
  HEADING_STYLE,
  MODULES_CONTAINER,
  CoolingLoopBox,
} from '../../shared/index.js';

export function CoolingPage() {
  return (
    <div style={PAGE_STYLE}>
      <h1 style={HEADING_STYLE}>Cooling</h1>
      <div style={MODULES_CONTAINER}>
        <CoolingLoopBox loop="Facility_Loop" />
        <CoolingLoopBox loop="Acc_Loop" />
      </div>
    </div>
  );
}

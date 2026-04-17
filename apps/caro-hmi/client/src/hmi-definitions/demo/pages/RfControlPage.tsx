/**
 * Demo RF Control Page
 */
import {
  PAGE_STYLE,
  HEADING_STYLE,
  MODULES_CONTAINER,
  RfOverviewBox,
  AccBox,
} from '../../shared/index.js';

export function RfControlPage() {
  return (
    <div style={PAGE_STYLE}>
      <h1 style={HEADING_STYLE}>RF Control</h1>
      <div style={MODULES_CONTAINER}>
        <RfOverviewBox />
        <AccBox acc="Acc_1" />
        <AccBox acc="Acc_2" />
        <AccBox acc="Acc_3" />
        <AccBox acc="Acc_4" />
      </div>
    </div>
  );
}

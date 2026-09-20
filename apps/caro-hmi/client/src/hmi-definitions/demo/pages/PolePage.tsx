import { PoleBox, SpecABox } from '../../shared/index.js';
import { PAGE_STYLE, HEADING_STYLE, MODULES_CONTAINER } from '../../shared/index.js';

export function PolePage() {
  return (
    <div style={PAGE_STYLE}>
      <h1 style={HEADING_STYLE}>Pole</h1>
      <div style={MODULES_CONTAINER}>
        <PoleBox />
        <SpecABox />
      </div>
    </div>
  );
}

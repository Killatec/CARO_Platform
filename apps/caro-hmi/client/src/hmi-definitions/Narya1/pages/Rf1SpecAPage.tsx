/**
 * Narya1 RF1 Spec A Page
 *
 * The reference "RF SpecA" page, split out of RF1Page. Offender-trace
 * clearing by Reset_Count / the module Reset command is not built yet (see
 * Docs/platform/platform_todo.md); SpecAChart's Clear button clears in the
 * browser only.
 */
import { PAGE_STYLE, HEADING_STYLE } from '../../shared/index.js';
import { Rf1SpecABox } from '../boxes/index.js';

export function Rf1SpecAPage() {
  return (
    <div style={PAGE_STYLE}>
      <h1 style={HEADING_STYLE}>RF1 Spec A</h1>
      <Rf1SpecABox />
    </div>
  );
}

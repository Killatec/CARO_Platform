/**
 * Narya1 System Overview Page
 *
 * HMI status and module status boxes — generic diagnostics, not
 * Narya1-specific. Machine-specific boxes land here once the Narya1
 * registry templates are built out (see Docs/platform_todo.md).
 */
import {
  HmiStatusBox,
  TrendStatusBox,
  ModuleStatusBox,
  PAGE_STYLE,
  MODULES_CONTAINER,
} from '../../shared/index.js';

export function SystemOverviewPage() {
  return (
    <div style={PAGE_STYLE}>
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

import type { TreeNode } from '../../shell/types.js';
import { SystemOverviewPage } from './pages/SystemOverviewPage.js';
// The two Dev pages are generic diagnostics, not demo-specific — reused
// directly rather than duplicated. Revisit if/when demo/ is retired.
import { TrendsPerfTestPage } from '../demo/pages/TrendsPerfTestPage.js';
import { TrendViewerTestPage } from '../demo/pages/TrendViewerTestPage.js';

export const tree: TreeNode[] = [
  {
    id: 'overview',
    label: 'System Overview',
    page: SystemOverviewPage,
  },
  {
    id: 'dev-trends-perf',
    label: 'Dev: Trends Perf',
    page: TrendsPerfTestPage,
  },
  {
    id: 'dev-trend-viewer',
    label: 'Dev: Trend Viewer',
    page: TrendViewerTestPage,
  },
];

import type { TreeNode } from '../../shell/types.js';
import { OverviewPage } from './pages/OverviewPage.js';

export const tree: TreeNode[] = [
  {
    id: 'overview',
    label: 'System Overview',
    page: OverviewPage,
  },
];

import type { TreeNode } from '../../shell/types.js';
import { SummaryPage } from './pages/SummaryPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { Beam1Page } from './pages/Beam1Page.js';
import { RfControlPage } from './pages/RfControlPage.js';
import { PowerPage } from './pages/PowerPage.js';
import { CoolingPage } from './pages/CoolingPage.js';

export const tree: TreeNode[] = [
  {
    id: 'overview',
    label: 'System Overview',
    page: OverviewPage,
  },
  {
    id: 'beam-1',
    label: 'Beam-1',
    page: Beam1Page,
  },
  {
    id: 'rf-control',
    label: 'RF Control',
    page: RfControlPage,
  },
  {
    id: 'power',
    label: 'Power',
    page: PowerPage,
  },
  {
    id: 'cooling',
    label: 'Cooling',
    page: CoolingPage,
  },
  {
    id: 'summary',
    label: 'Summary',
    page: SummaryPage,
  },
];

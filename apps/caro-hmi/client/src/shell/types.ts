import type { ComponentType } from 'react';

export interface TreeNode {
  id: string;
  label: string;
  page: ComponentType;
  children?: TreeNode[];
}

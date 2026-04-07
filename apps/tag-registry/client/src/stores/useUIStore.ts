import { create } from 'zustand';
import type { ValidationConfig } from '../api/config.js';
import type { BatchChange, BatchDeletion } from '../api/templates.js';

export type ActiveTab = 'editor' | 'registry' | 'history';
export type ActiveModal = 'cascade' | 'cascadeConfirm' | 'cascadePreview' | 'confirm' | null;

export interface PendingBatch {
  changes: BatchChange[];
  deletions?: BatchDeletion[];
}

export interface UIStoreState {
  validationConfig: ValidationConfig;
  selectedNodeName: string | null;
  selectedParentName: string | null;
  activeTab: ActiveTab;
  activeModal: ActiveModal;
  modalProps: Record<string, unknown>;
  pendingBatch: PendingBatch | null;
  selectedTemplateTree: string | null;
  selectedSystemTreeNode: string | null;
  selectedSystemTreeNodeParentPath: string | null;
  selectedSystemTreeNodeAssetName: string | null;
  selectedSystemTreeNodeParentTemplate: string | null;
  selectedSystemTreeNodeChildIndex: number | null;

  setValidationConfig: (config: ValidationConfig) => void;
  selectNode: (nodeName: string, parentName?: string | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
  openModal: (modalType: ActiveModal, props?: Record<string, unknown>) => void;
  closeModal: () => void;
  setPendingBatch: (batch: PendingBatch) => void;
  clearPendingBatch: () => void;
  setSelectedTemplateTree: (name: string | null) => void;
  setSelectedSystemTreeNode: (
    ownPath: string | null,
    parentPath?: string | null,
    assetName?: string | null,
    parentTemplateName?: string | null,
    childIndex?: number | null
  ) => void;
}

/**
 * UI store - manages UI state (selected node, modals, etc.)
 */
export const useUIStore = create<UIStoreState>((set) => ({
  // Validation config — populated from GET /api/v1/config on app mount
  validationConfig: { requiredParentTypes: [], uniqueParentTypes: false },

  // State
  selectedNodeName: null,
  selectedParentName: null,
  activeTab: 'editor',
  activeModal: null,
  modalProps: {},
  pendingBatch: null,

  selectedTemplateTree: null,
  selectedSystemTreeNode: null,
  selectedSystemTreeNodeParentPath: null,
  selectedSystemTreeNodeAssetName: null,
  selectedSystemTreeNodeParentTemplate: null,
  selectedSystemTreeNodeChildIndex: null,

  // Actions
  setValidationConfig: (config) => set({ validationConfig: config }),

  selectNode: (nodeName, parentName = null) => set({ selectedNodeName: nodeName, selectedParentName: parentName }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  openModal: (modalType, props = {}) => set({ activeModal: modalType, modalProps: props }),

  closeModal: () => set({ activeModal: null, modalProps: {}, pendingBatch: null }),

  setPendingBatch: (batch) => set({ pendingBatch: batch }),
  clearPendingBatch: () => set({ pendingBatch: null }),

  setSelectedTemplateTree: (name) => set({
    selectedTemplateTree: name,
    selectedSystemTreeNode: null,
    selectedSystemTreeNodeParentPath: null,
    selectedSystemTreeNodeAssetName: null,
    selectedSystemTreeNodeParentTemplate: null,
    selectedSystemTreeNodeChildIndex: null,
    selectedNodeName: null,
    selectedParentName: null,
  }),

  setSelectedSystemTreeNode: (ownPath, parentPath = null, assetName = null, parentTemplateName = null, childIndex = null) => set({
    selectedSystemTreeNode: ownPath,
    selectedSystemTreeNodeParentPath: parentPath,
    selectedSystemTreeNodeAssetName: assetName,
    selectedSystemTreeNodeParentTemplate: parentTemplateName,
    selectedSystemTreeNodeChildIndex: childIndex,
    selectedTemplateTree: null,
    selectedNodeName: assetName,
    selectedParentName: parentTemplateName,
  }),
}));

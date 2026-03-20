import { create } from 'zustand';

/**
 * UI store - manages UI state (selected node, modals, etc.)
 */
export const useUIStore = create((set) => ({
  // State
  selectedNodeName: null,
  selectedParentName: null,
  activeTab: 'editor', // 'editor' | 'registry'
  activeModal: null, // 'cascade' | 'cascadePreview' | 'confirm' | null
  modalProps: {},
  pendingBatch: null, // Stores the pending batch changes for cascade confirmation

  // Mutual-exclusion panel selection:
  // Exactly one is non-null at a time, or both null (blank FieldsPanel).
  selectedTemplateTree: null,    // string | null — template_name selected in TemplatesTree
  selectedSystemTreeNode: null,  // string | null — full dot-separated tree path (unique identity key)
  selectedSystemTreeNodeParentPath: null,      // string | null — full path to parent node
  selectedSystemTreeNodeAssetName: null,       // string | null — this node's own asset_name segment
  selectedSystemTreeNodeParentTemplate: null,  // string | null — template_name of the parent template
  selectedSystemTreeNodeChildIndex: null,      // number | null — index of this node in parent's children array

  // Actions
  selectNode: (nodeName, parentName = null) => set({ selectedNodeName: nodeName, selectedParentName: parentName }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  openModal: (modalType, props = {}) => set({ activeModal: modalType, modalProps: props }),

  closeModal: () => set({ activeModal: null, modalProps: {}, pendingBatch: null }),

  setPendingBatch: (batch) => set({ pendingBatch: batch }),
  clearPendingBatch: () => set({ pendingBatch: null }),

  // Select a template from the TemplatesTree — clears system tree selection.
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

  // Select a node from the AssetTree — clears template tree selection.
  // ownPath: full dot-separated path (unique identity key)
  // parentPath: full path to the parent node (null for root)
  // assetName: this node's own asset_name segment (null for root)
  // parentTemplateName: template_name of the parent template (null for root)
  // childIndex: index of this node in parent's children array (null for root)
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

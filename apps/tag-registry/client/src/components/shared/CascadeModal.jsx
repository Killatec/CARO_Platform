import React from 'react';
import { Modal, Button } from '@caro/ui/primitives';
import { useUIStore } from '../../stores/useUIStore.js';
import { useTemplateGraphStore } from '../../stores/useTemplateGraphStore.js';
import { CascadeDiffContent } from './CascadeDiffContent.jsx';

/**
 * CascadeModal - server-triggered cascade confirmation
 */
export function CascadeModal() {
  const activeModal = useUIStore(state => state.activeModal);
  const modalProps = useUIStore(state => state.modalProps);
  const closeModal = useUIStore(state => state.closeModal);
  const pendingBatch = useUIStore(state => state.pendingBatch);
  const clearPendingBatch = useUIStore(state => state.clearPendingBatch);
  const confirmSave = useTemplateGraphStore(state => state.confirmSave);

  const isOpen = activeModal === 'cascadeConfirm';

  if (!isOpen) return null;

  const { diff = {}, affectedParents = [], new_templates = [], children_changed = [], pending_deletions = [] } = modalProps;

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title="Save — Confirm Changes">
      <div className="space-y-4">
        <CascadeDiffContent diff={diff} affectedParents={affectedParents} newTemplates={new_templates} childrenChanged={children_changed} pendingDeletions={pending_deletions} />

        <div className="flex gap-2 pt-4 border-t">
          <Button
            variant="primary"
            onClick={() => {
              confirmSave(pendingBatch);
              clearPendingBatch();
              closeModal();
            }}
          >
            Confirm
          </Button>
          <Button variant="secondary" onClick={() => { clearPendingBatch(); closeModal(); }}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

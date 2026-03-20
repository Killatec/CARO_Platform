import React from 'react';
import { Modal, Button } from '@caro/ui/primitives';
import { useUIStore } from '../../stores/useUIStore.js';
import { CascadeDiffContent } from './CascadeDiffContent.jsx';

/**
 * CascadePreviewModal - client-triggered preview (informational)
 */
export function CascadePreviewModal() {
  const activeModal = useUIStore(state => state.activeModal);
  const modalProps = useUIStore(state => state.modalProps);
  const closeModal = useUIStore(state => state.closeModal);

  const isOpen = activeModal === 'cascadePreview';

  if (!isOpen) return null;

  const { diff = {}, affectedParents = [], new_templates = [], children_changed = [], pending_deletions = [] } = modalProps;

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title="What's Changed">
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          Preview of changes to your template graph.
        </p>

        <CascadeDiffContent diff={diff} affectedParents={affectedParents} newTemplates={new_templates} childrenChanged={children_changed} pendingDeletions={pending_deletions} />

        <div className="flex justify-end pt-4 border-t">
          <Button variant="secondary" onClick={closeModal}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

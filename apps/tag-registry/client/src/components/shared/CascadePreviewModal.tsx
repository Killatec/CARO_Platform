import React from 'react';
import { Modal, Button } from '@caro/ui/primitives';
import { useUIStore } from '../../stores/useUIStore.js';
import { CascadeDiffContent } from './CascadeDiffContent.jsx';

/**
 * CascadePreviewModal - client-triggered preview (informational)
 */
export function CascadePreviewModal(): React.ReactElement | null {
  const activeModal = useUIStore(state => state.activeModal);
  const modalProps = useUIStore(state => state.modalProps);
  const closeModal = useUIStore(state => state.closeModal);

  const isOpen = activeModal === 'cascadePreview';

  if (!isOpen) return null;

  const {
    diff = {},
    affectedParents = [],
    new_templates = [],
    children_changed = [],
    pending_deletions = []
  } = modalProps as Record<string, unknown> & {
    diff?: Record<string, unknown>;
    affectedParents?: unknown[];
    new_templates?: unknown[];
    children_changed?: unknown[];
    pending_deletions?: unknown[];
  };

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title="What's Changed">
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          Preview of changes to your template graph.
        </p>

        <CascadeDiffContent
          diff={diff as Parameters<typeof CascadeDiffContent>[0]['diff']}
          affectedParents={affectedParents as Parameters<typeof CascadeDiffContent>[0]['affectedParents']}
          newTemplates={new_templates as Parameters<typeof CascadeDiffContent>[0]['newTemplates']}
          childrenChanged={children_changed as Parameters<typeof CascadeDiffContent>[0]['childrenChanged']}
          pendingDeletions={pending_deletions as Parameters<typeof CascadeDiffContent>[0]['pendingDeletions']}
        />

        <div className="flex justify-end pt-4 border-t">
          <Button variant="secondary" onClick={closeModal}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

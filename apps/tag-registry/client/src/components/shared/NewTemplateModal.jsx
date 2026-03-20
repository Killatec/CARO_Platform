import React, { useState, useEffect } from 'react';
import { Modal, Button, Input } from '@caro/ui/primitives';

/**
 * NewTemplateModal — collect template_name and template_type for a new template.
 *
 * Props:
 *   isOpen           — controls visibility
 *   onConfirm(name, type) — called with validated values
 *   onCancel()       — called on cancel or close
 *   existingTypes    — array of template_type strings already in use (for datalist)
 *   existingNames    — array of template_name strings already in use (for duplicate check)
 */
export function NewTemplateModal({ isOpen, onConfirm, onCancel, existingTypes = [], existingNames = [] }) {
  const [templateName, setTemplateName] = useState('');
  const [templateType, setTemplateType] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTemplateName('');
      setTemplateType('');
      setError('');
    }
  }, [isOpen]);

  const handleConfirm = () => {
    const name = templateName.trim();
    const type = templateType.trim();
    if (!name) { setError('Template name is required.'); return; }
    if (/[\s.]/.test(name)) { setError('Template name must not contain spaces or dots.'); return; }
    if (existingNames.includes(name)) { setError(`"${name}" already exists.`); return; }
    if (!type) { setError('Template type is required.'); return; }
    onConfirm(name, type);
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="New Template">
      <div className="space-y-4">

        <div>
          <label htmlFor="new-template-name" className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
          <Input
            id="new-template-name"
            value={templateName}
            onChange={(e) => { setTemplateName(e.target.value); setError(''); }}
            placeholder="e.g. RF_Param"
            className="w-full"
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="new-template-type" className="block text-sm font-medium text-gray-700 mb-1">Template Type</label>
          <input
            id="new-template-type"
            list="new-template-type-options"
            value={templateType}
            onChange={(e) => { setTemplateType(e.target.value); setError(''); }}
            placeholder="Select existing or enter new…"
            className="border border-gray-300 rounded px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <datalist id="new-template-type-options">
            {existingTypes.map(t => <option key={t} value={t} />)}
          </datalist>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 pt-4 border-t">
          <Button variant="primary" onClick={handleConfirm}>Confirm</Button>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

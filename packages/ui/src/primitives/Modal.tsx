import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps extends React.HTMLAttributes<HTMLDivElement> {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  maxWidthClass?: string;
  /** Replaces the full `${maxWidthClass} w-full` size token pair. When provided, maxWidthClass is ignored. */
  widthClass?: string;
  /** Replaces the default body div class. Use when the caller manages its own internal scrolling. */
  bodyClassName?: string;
}

/**
 * Modal primitive - stateless, zero domain knowledge
 */
export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, maxWidthClass = 'max-w-2xl', widthClass, bodyClassName, children, ...props }) => {
  useEffect(() => {
    if (isOpen) {
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto" {...props}>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal content */}
      <div className="relative z-10 flex min-h-full items-center justify-center p-4">
        <div
          className={`relative bg-white rounded-lg shadow-xl ${widthClass ?? `${maxWidthClass} w-full`} max-h-[90vh] overflow-hidden`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          {title && (
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            </div>
          )}

          {/* Body */}
          <div className={bodyClassName ?? 'px-6 py-4 overflow-y-auto max-h-[calc(90vh-8rem)]'}>
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

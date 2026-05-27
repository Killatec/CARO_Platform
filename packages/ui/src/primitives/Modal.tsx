import React, { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps extends React.HTMLAttributes<HTMLDivElement> {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  maxWidthClass?: string;
  /** Replaces the full `${maxWidthClass} w-full` size token pair. When provided, maxWidthClass is ignored. */
  widthClass?: string;
  /** Appended to the outer white box's className. Use to add padding or other styles to the modal frame. */
  outerClassName?: string;
  /** Replaces the default header div class. */
  headerClassName?: string;
  /** Replaces the default body div class. Use when the caller manages its own internal scrolling. */
  bodyClassName?: string;
  /** Inline style applied to the outer white box. Takes precedence over class-based styles. */
  outerStyle?: CSSProperties;
  /** Inline style applied to the header div. */
  headerStyle?: CSSProperties;
  /** Inline style applied to the body div. */
  bodyStyle?: CSSProperties;
}

/**
 * Modal primitive - stateless, zero domain knowledge
 */
export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, maxWidthClass = 'max-w-2xl', widthClass, outerClassName, headerClassName, bodyClassName, outerStyle, headerStyle, bodyStyle, children, ...props }) => {
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
          className={`relative bg-white rounded-lg shadow-xl ${widthClass ?? `${maxWidthClass} w-full`} max-h-[90vh] overflow-hidden${outerClassName ? ' ' + outerClassName : ''}`}
          style={outerStyle}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          {title && (
            <div className={headerClassName ?? 'px-6 py-4 border-b border-gray-200'} style={headerStyle}>
              <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            </div>
          )}

          {/* Body */}
          <div className={bodyClassName ?? 'px-6 py-4 overflow-y-auto max-h-[calc(90vh-8rem)]'} style={bodyStyle}>
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

import React from 'react';
import { Badge } from '@caro/ui/primitives';

/**
 * SeverityBadge - displays error/warning severity with appropriate styling
 */
export function SeverityBadge({ severity, ...props }) {
  const variant = severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'default';

  return (
    <Badge variant={variant} {...props}>
      {severity}
    </Badge>
  );
}

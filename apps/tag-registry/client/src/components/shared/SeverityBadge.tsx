import React from 'react';
import { Badge } from '@caro/ui/primitives';

interface SeverityBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  severity: string;
}

/**
 * SeverityBadge - displays error/warning severity with appropriate styling
 */
export function SeverityBadge({ severity, ...props }: SeverityBadgeProps): React.ReactElement {
  const variant = severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'default';

  return (
    <Badge variant={variant} {...props}>
      {severity}
    </Badge>
  );
}

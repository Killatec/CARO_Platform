import type { FC } from 'react';
import { WidgetErrorBoundary } from './WidgetErrorBoundary.js';

export function withErrorBoundary<P extends { assetPath: string }>(
  Component: FC<P>,
): FC<P> {
  const Wrapped: FC<P> = (props) => (
    <WidgetErrorBoundary assetPath={props.assetPath}>
      <Component {...props} />
    </WidgetErrorBoundary>
  );
  Wrapped.displayName = `WithErrorBoundary(${Component.displayName ?? Component.name ?? 'Component'})`;
  return Wrapped;
}

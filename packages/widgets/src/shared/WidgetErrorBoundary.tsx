import { Component } from 'react';
import type { CSSProperties, ReactNode } from 'react';

interface Props {
  assetPath: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

const BOX_STYLE: CSSProperties = {
  border: '1px solid #f87171',
  background: '#fef2f2',
  padding: '8px 12px',
  borderRadius: 4,
  fontSize: 12,
  color: '#dc2626',
  maxWidth: 280,
};

const PATH_STYLE: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  wordBreak: 'break-all',
};

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div style={BOX_STYLE}>
          <strong>Widget error</strong>
          <br />
          <span style={PATH_STYLE}>{this.props.assetPath}</span>
          <br />
          {error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

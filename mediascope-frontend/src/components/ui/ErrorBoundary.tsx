/**
 * ErrorBoundary — wraps any analytics widget so a single render bug doesn't
 * blow up the whole dashboard.
 *
 * Usage:
 *   <ErrorBoundary label="Top Entities">
 *     <TopEntitiesPanel />
 *   </ErrorBoundary>
 */
import React from 'react';

interface Props {
  label?: string;
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to console for devtools; future: send to telemetry endpoint.
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary] ${this.props.label || 'widget'} crashed:`, error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: '1.25rem',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--bg-primary)',
            color: 'var(--text-secondary)',
            fontSize: '0.85rem',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
            {this.props.label ? `${this.props.label} failed to load` : 'Widget failed to load'}
          </div>
          <div style={{ marginBottom: 10, opacity: 0.8 }}>
            {this.state.error.message || 'Unknown error.'}
          </div>
          <button
            onClick={this.reset}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children as React.ReactElement;
  }
}

export default ErrorBoundary;

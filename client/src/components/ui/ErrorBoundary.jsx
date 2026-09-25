import { Component } from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';

const newErrorId = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const isDev = import.meta.env.DEV;

function Fallback({ error, errorId, compact = false, onRetry }) {
  return (
    <div
      role="alert"
      data-testid="error-boundary"
      className={`mx-auto flex max-w-lg flex-col items-center text-center ${compact ? 'p-4' : 'p-10'}`}
    >
      <span className="mb-3 text-3xl" aria-hidden="true">⚠️</span>
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Something went wrong</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {compact ? 'This panel crashed; the rest of the page still works.' : 'This page hit an unexpected error.'} Error id{' '}
        <span className="font-mono">{errorId}</span>.
      </p>
      {isDev && error?.stack && (
        <pre className="mt-4 max-h-48 w-full overflow-auto rounded-lg bg-slate-100 p-3 text-left text-[11px] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
          {error.stack}
        </pre>
      )}
      <div className="mt-4 flex gap-2">
        {onRetry && (
          <button type="button" onClick={onRetry} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700 dark:text-slate-200">
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

/**
 * The data router's `errorElement` (spec/36 §6): a page that throws while
 * rendering or loading shows this instead of a blank screen.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm text-slate-500">This page doesn&apos;t exist.</p>
        <Link to="/" className="text-sm text-brand-600">Go home</Link>
      </div>
    );
  }
  const errorId = newErrorId();
  console.error(`[route error ${errorId}]`, error);
  return <Fallback error={error} errorId={errorId} />;
}

/**
 * A render-time boundary for part of a page. The Builder wraps the node config
 * panel in one, so a crashing panel doesn't blank the canvas.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorId: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error, errorId: newErrorId() };
  }

  // A new resetKey (e.g. another node selected) clears the error.
  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) return { resetKey: props.resetKey, error: null, errorId: null };
    return null;
  }

  componentDidCatch(error) {
    console.error(`[error boundary ${this.state.errorId}]`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <Fallback
          error={this.state.error}
          errorId={this.state.errorId}
          compact={this.props.compact}
          onRetry={() => this.setState({ error: null, errorId: null })}
        />
      );
    }
    return this.props.children;
  }
}

export function CanvasErrorBoundary({ children, resetKey }) {
  return <ErrorBoundary compact resetKey={resetKey}>{children}</ErrorBoundary>;
}

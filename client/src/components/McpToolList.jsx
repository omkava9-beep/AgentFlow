import { useCallback, useEffect, useRef, useState } from 'react';
import { listMcpTools, refreshMcpTools } from '../api/mcp';
import { apiErrorMessage } from '../api/client';
import { annotationBadges } from '../utils/mcpSchema';

const SOURCE_LABEL = { live: 'from the live server', cache: 'cached from the server', snapshot: 'from the saved snapshot' };

const BADGE_TONE = {
  'read-only': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'side effect': 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  destructive: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

export function ToolBadges({ annotations }) {
  return annotationBadges(annotations).map((b) => (
    <span key={b} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${BADGE_TONE[b]}`}>
      {b}
    </span>
  ));
}

/**
 * The tools an MCP connection offers (spec/37 UI): name, description, the
 * read-only / side-effect badge from its annotations, when the list was
 * fetched and from where, and a Refresh button that re-runs discovery.
 */
export default function McpToolList({ connectionId, onLoaded }) {
  const [state, setState] = useState({ loading: true, tools: [], fetchedAt: null, source: null, error: '' });
  const [refreshing, setRefreshing] = useState(false);

  // A ref, so a parent passing an inline callback doesn't re-trigger discovery.
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const apply = useCallback((data) => {
    setState({ loading: false, error: '', ...data });
    onLoadedRef.current?.(data.tools);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: '' }));
    listMcpTools(connectionId)
      .then((data) => !cancelled && apply(data))
      .catch((err) => !cancelled && setState((s) => ({ ...s, loading: false, error: apiErrorMessage(err, 'Could not list tools') })));
    return () => {
      cancelled = true;
    };
  }, [connectionId, apply]);

  async function refresh() {
    setRefreshing(true);
    try {
      apply(await refreshMcpTools(connectionId));
    } catch (err) {
      setState((s) => ({ ...s, error: apiErrorMessage(err, 'Refresh failed') }));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div data-testid="mcp-tool-list" className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {state.loading ? 'Discovering tools…' : `Discovered ${state.tools.length} tool${state.tools.length === 1 ? '' : 's'}`}
        </p>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="text-xs text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
        >
          {refreshing ? 'Refreshing…' : 'Refresh tools'}
        </button>
      </div>
      {(state.fetchedAt || state.source) && (
        <p className="text-[11px] text-slate-400">
          {state.fetchedAt && `Fetched ${new Date(state.fetchedAt).toLocaleString()}`}
          {state.source && ` · ${SOURCE_LABEL[state.source] || state.source}`}
        </p>
      )}
      {state.error && <p className="text-xs text-red-500">{state.error}</p>}
      <ul className="max-h-56 space-y-1.5 overflow-y-auto">
        {state.tools.map((tool) => (
          <li key={tool.name} className="rounded-md bg-slate-50 px-2 py-1.5 text-xs dark:bg-slate-800/60">
            <div className="flex items-center gap-1.5">
              <code className="font-semibold text-slate-700 dark:text-slate-200">{tool.name}</code>
              <ToolBadges annotations={tool.annotations} />
            </div>
            {tool.description && <p className="mt-0.5 text-slate-500 dark:text-slate-400">{tool.description}</p>}
          </li>
        ))}
      </ul>
      {!state.loading && !state.error && !state.tools.length && (
        <p className="text-xs text-slate-400">This server offers no tools.</p>
      )}
    </div>
  );
}

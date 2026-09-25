import { useCallback, useEffect, useRef, useState } from 'react';
import { listMcpTools, refreshMcpTools } from '../api/mcp';
import { apiErrorMessage } from '../api/client';
import { RefreshCw, Wrench } from 'lucide-react';
import { annotationBadges } from '../utils/mcpSchema';
import { Badge, Button, Skeleton } from './ui/index';

const SOURCE_LABEL = { live: 'from the live server', cache: 'cached from the server', snapshot: 'from the saved snapshot' };

const BADGE_TONE = { 'read-only': 'success', 'side effect': 'warning', destructive: 'danger' };

export function ToolBadges({ annotations }) {
  return annotationBadges(annotations).map((b) => (
    <Badge key={b} tone={BADGE_TONE[b] || 'neutral'} size="xs">{b}</Badge>
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
    <div data-testid="mcp-tool-list" className="overflow-hidden rounded-card border border-default">
      <div className="flex items-center justify-between gap-3 border-b border-default bg-bg-subtle/60 px-3 py-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
            <Wrench className="h-3.5 w-3.5 text-subtle" aria-hidden="true" />
            {state.loading ? 'Discovering tools…' : `Discovered ${state.tools.length} tool${state.tools.length === 1 ? '' : 's'}`}
          </p>
          {(state.fetchedAt || state.source) && (
            <p className="truncate text-2xs text-subtle">
              {state.fetchedAt && `Fetched ${new Date(state.fetchedAt).toLocaleString()}`}
              {state.source && ` · ${SOURCE_LABEL[state.source] || state.source}`}
            </p>
          )}
        </div>
        <Button variant="ghost" size="xs" icon={RefreshCw} loading={refreshing} onClick={refresh}>
          {refreshing ? 'Refreshing…' : 'Refresh tools'}
        </Button>
      </div>
      {state.error && <p className="px-3 py-2 text-xs text-danger">{state.error}</p>}
      {state.loading && !state.tools.length && (
        <div className="space-y-2 p-3"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
      )}
      {state.tools.length > 0 && (
        <ul className="max-h-56 divide-y divide-default overflow-y-auto">
          {state.tools.map((tool) => (
            <li key={tool.name} className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <code className="font-mono text-xs font-semibold text-fg">{tool.name}</code>
                <ToolBadges annotations={tool.annotations} />
              </div>
              {tool.description && <p className="mt-0.5 text-xs text-muted">{tool.description}</p>}
            </li>
          ))}
        </ul>
      )}
      {!state.loading && !state.error && !state.tools.length && (
        <p className="px-3 py-3 text-xs text-subtle">This server offers no tools.</p>
      )}
    </div>
  );
}

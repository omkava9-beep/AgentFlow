import { useEffect, useMemo, useState } from 'react';
import { useIntegrationStore } from '../../store/integrationStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { listMcpTools } from '../../api/mcp';
import { integrationIcon, needsCredentials } from '../../utils/integrationCatalog';
import { toolToAction, snapshotTools, actionHasSideEffect, MAX_AGENT_TOOLS } from '../../utils/mcpSchema';
import { ToolBadges } from '../McpToolList';

const sameTool = (a, b) =>
  a.integration === b.integration && a.action === b.action && (a.connectionId || null) === (b.connectionId || null);

/**
 * The agent node's "Tools" picker (spec/37 §5): MCP tools grouped by
 * connection, plus any integration action, capped at 20 because every tool
 * definition is sent to the model on every step.
 *
 * Config shape: `tools: [{ integration, action, connectionId }]` and
 * `allowSideEffects`. Anything not marked read-only counts as side-effecting
 * and needs the explicit opt-in — the server rejects the node otherwise.
 */
export default function AgentToolsField({ config, set, readOnly }) {
  const catalog = useIntegrationStore((s) => s.catalog);
  const connections = useIntegrationStore((s) => s.connections);
  const loadCatalog = useIntegrationStore((s) => s.loadCatalog);
  const loadConnections = useIntegrationStore((s) => s.loadConnections);
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [mcpTools, setMcpTools] = useState({}); // connectionId -> actions | 'loading' | 'error'

  useEffect(() => {
    loadCatalog();
    if (workspaceId) loadConnections(workspaceId);
  }, [workspaceId, loadCatalog, loadConnections]);

  const tools = useMemo(() => config.tools || [], [config.tools]);
  const mcpConnections = (connections || []).filter((c) => c.integration === 'mcp');
  const staticIntegrations = (catalog || []).filter((i) => !i.dynamicActions && (i.actions || []).length);

  function loadTools(connectionId) {
    if (mcpTools[connectionId] && mcpTools[connectionId] !== 'error') return;
    setMcpTools((m) => ({ ...m, [connectionId]: 'loading' }));
    listMcpTools(connectionId)
      .then(({ tools: list }) => setMcpTools((m) => ({ ...m, [connectionId]: list.map(toolToAction) })))
      .catch(() => setMcpTools((m) => ({ ...m, [connectionId]: 'error' })));
  }

  function toggleGroup(key, connectionId) {
    if (!open.has(key) && connectionId) loadTools(connectionId);
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Expanding everything while searching, so matches are visible without clicking.
  useEffect(() => {
    if (query.trim()) mcpConnections.forEach((c) => loadTools(c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  /** The action object behind one entry, for its name and side-effect status. */
  function actionFor(entry) {
    if (entry.integration === 'mcp') {
      const loaded = mcpTools[entry.connectionId];
      if (Array.isArray(loaded)) return loaded.find((a) => a.id === entry.action) || null;
      const snap = snapshotTools((connections || []).find((c) => c.id === entry.connectionId));
      const tool = snap?.find((t) => t.name === entry.action);
      return tool ? toolToAction(tool) : null;
    }
    return (catalog || []).find((i) => i.id === entry.integration)?.actions?.find((a) => a.id === entry.action) || null;
  }

  function toggle(entry) {
    const has = tools.some((t) => sameTool(t, entry));
    if (has) set({ tools: tools.filter((t) => !sameTool(t, entry)) });
    else if (tools.length < MAX_AGENT_TOOLS) set({ tools: [...tools, entry] });
  }

  function setEntryConnection(index, connectionId) {
    set({ tools: tools.map((t, i) => (i === index ? { ...t, connectionId } : t)) });
  }

  const q = query.trim().toLowerCase();
  const matches = (action) => !q || `${action.id} ${action.name} ${action.description || ''}`.toLowerCase().includes(q);
  const sideEffectTools = tools.filter((t) => actionHasSideEffect(actionFor(t)));
  const atCap = tools.length >= MAX_AGENT_TOOLS;

  const checkbox = (entry, action) => {
    const checked = tools.some((t) => sameTool(t, entry));
    return (
      <label
        key={`${entry.integration}:${entry.connectionId || ''}:${entry.action}`}
        className="flex items-start gap-2 rounded px-1 py-0.5 text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60"
      >
        <input
          type="checkbox"
          className="mt-0.5 accent-brand-500"
          checked={checked}
          disabled={readOnly || (!checked && atCap)}
          onChange={() => toggle(entry)}
        />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{action.name}</span>
          {action.description && <span className="block truncate text-slate-400">{action.description}</span>}
        </span>
        {actionHasSideEffect(action) && (
          <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">side effect</span>
        )}
      </label>
    );
  };

  return (
    <div data-testid="agent-tools" className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tools</p>
        <span className={`text-xs ${atCap ? 'text-amber-600' : 'text-slate-400'}`}>
          {tools.length} / {MAX_AGENT_TOOLS}
        </span>
      </div>

      {tools.length > 0 && (
        <ul className="space-y-1">
          {tools.map((entry, i) => {
            const action = actionFor(entry);
            const integration = (catalog || []).find((x) => x.id === entry.integration);
            const conn = (connections || []).find((c) => c.id === entry.connectionId);
            const own = (connections || []).filter((c) => c.integration === entry.integration);
            return (
              <li key={i} className="rounded-md bg-slate-50 px-2 py-1.5 text-xs dark:bg-slate-800/60">
                <div className="flex items-center gap-1.5">
                  <span>{integrationIcon(integration?.icon || entry.integration)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200">
                    {entry.integration === 'mcp' ? `${conn?.name || 'Missing connection'} → ` : `${integration?.name || entry.integration} · `}
                    {action?.name || entry.action}
                  </span>
                  {action?.annotations ? <ToolBadges annotations={action.annotations} /> : actionHasSideEffect(action) && (
                    <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">side effect</span>
                  )}
                  {!readOnly && (
                    <button type="button" aria-label="Remove tool" onClick={() => toggle(entry)} className="text-slate-400 hover:text-red-500">
                      ✕
                    </button>
                  )}
                </div>
                {entry.integration !== 'mcp' && integration && needsCredentials(integration) && (
                  <select
                    disabled={readOnly}
                    value={entry.connectionId || ''}
                    onChange={(e) => setEntryConnection(i, e.target.value || null)}
                    className="mt-1 w-full rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="">No connection — sandbox</option>
                    {own.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.mode === 'sandbox' ? ' (sandbox)' : ''}
                      </option>
                    ))}
                    <option value="sandbox">Sandbox (no account)</option>
                  </select>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <>
          <input
            type="search"
            placeholder="Search tools…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          />
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {mcpConnections.map((c) => {
              const key = `mcp:${c.id}`;
              const loaded = mcpTools[c.id];
              const expanded = open.has(key) || Boolean(q);
              const list = Array.isArray(loaded) ? loaded.filter(matches) : [];
              if (q && Array.isArray(loaded) && !list.length) return null;
              return (
                <div key={key}>
                  <button type="button" onClick={() => toggleGroup(key, c.id)} className="flex w-full items-center gap-1 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <span>{expanded ? '▾' : '▸'}</span> 🔌 {c.name}
                    <span className="font-normal text-slate-400">MCP</span>
                  </button>
                  {expanded && (
                    <div className="ml-3 mt-1">
                      {loaded === 'loading' && <p className="text-xs text-slate-400">Discovering tools…</p>}
                      {loaded === 'error' && <p className="text-xs text-red-500">Couldn&rsquo;t list this server&rsquo;s tools.</p>}
                      {list.map((a) => checkbox({ integration: 'mcp', action: a.id, connectionId: c.id }, a))}
                    </div>
                  )}
                </div>
              );
            })}
            {staticIntegrations.map((integration) => {
              const key = `int:${integration.id}`;
              const list = (integration.actions || []).filter(matches);
              if (q && !list.length) return null;
              const expanded = open.has(key) || Boolean(q);
              return (
                <div key={key}>
                  <button type="button" onClick={() => toggleGroup(key)} className="flex w-full items-center gap-1 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <span>{expanded ? '▾' : '▸'}</span> {integrationIcon(integration.icon || integration.id)} {integration.name}
                  </button>
                  {expanded && (
                    <div className="ml-3 mt-1">{list.map((a) => checkbox({ integration: integration.id, action: a.id, connectionId: null }, a))}</div>
                  )}
                </div>
              );
            })}
            {!catalog && <p className="text-xs text-slate-400">Loading tools…</p>}
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          className="accent-brand-500"
          disabled={readOnly}
          checked={Boolean(config.allowSideEffects)}
          onChange={(e) => set({ allowSideEffects: e.target.checked })}
        />
        Allow side-effecting tools
      </label>
      {config.allowSideEffects ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
          Tool output is untrusted: a hostile page or ticket could steer the agent into calling a tool that sends or changes
          something. Put an Approval node in front of anything with real consequences.
        </p>
      ) : (
        sideEffectTools.length > 0 && (
          <p className="text-xs text-red-500">
            {sideEffectTools.length} selected tool{sideEffectTools.length === 1 ? ' has' : 's have'} side effects — allow them
            above or remove {sideEffectTools.length === 1 ? 'it' : 'them'}.
          </p>
        )
      )}
      {tools.length > 0 && (
        <p className="text-xs text-slate-400">
          With a real model the agent takes at most 8 tool-use steps before it must answer; the mock agent uses at most 2.
        </p>
      )}
    </div>
  );
}

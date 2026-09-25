import { useEffect, useState } from 'react';
import { listMcpAllowlist } from '../api/mcp';
import { TextField, Select } from './ui';

/**
 * The MCP-specific part of the connection form (spec/37 §1). Remote servers take
 * a URL plus an optional auth header; local servers are picked from the
 * operator's allowlist. There is deliberately no field for a command, args or
 * env: a stdio server is a process the backend spawns on its own machine, so
 * those only ever come from `server/mcp-servers.json` (C4).
 *
 * `values` holds `{ transport, url, headerName, allowlistId, authHeader }`;
 * `authHeader` is the one secret and follows the usual write-only rules.
 */
export default function McpConnectionFields({ values, onChange, hint, onClear, isEdit }) {
  const [allowlist, setAllowlist] = useState(null);
  const [allowlistError, setAllowlistError] = useState('');
  const transport = values.transport || 'http';
  const set = (patch) => onChange({ ...values, ...patch });

  useEffect(() => {
    if (transport !== 'stdio' || allowlist) return;
    listMcpAllowlist()
      .then((list) => setAllowlist(Array.isArray(list) ? list : []))
      .catch(() => {
        setAllowlist([]);
        setAllowlistError('Could not load the allowlist of local servers.');
      });
  }, [transport, allowlist]);

  const picked = (allowlist || []).find((s) => s.id === values.allowlistId);
  const cleared = values.authHeader === null;

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">MCP server</p>

      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Transport</span>
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
          {[
            ['http', 'Remote (HTTP)'],
            ['stdio', 'Local server'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-testid={`mcp-transport-${id}`}
              onClick={() => set({ transport: id })}
              className={`rounded-md px-3 py-1 text-sm transition ${
                transport === id ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {transport === 'http' ? (
        <>
          <TextField
            label="Server URL *"
            placeholder="https://mcp.example.com/mcp"
            value={values.url || ''}
            onChange={(e) => set({ url: e.target.value })}
          />
          <TextField
            label="Auth header name"
            placeholder="Authorization"
            value={values.headerName || ''}
            onChange={(e) => set({ headerName: e.target.value })}
          />
          <div>
            <TextField
              label="Auth header value"
              type="password"
              autoComplete="new-password"
              value={cleared ? '' : values.authHeader || ''}
              disabled={cleared}
              placeholder={cleared ? 'Will be cleared on save' : hint ? `${hint} — leave blank to keep` : 'Bearer … (optional)'}
              onChange={(e) => set({ authHeader: e.target.value })}
            />
            {hint && onClear && (
              <button
                type="button"
                onClick={() => (cleared ? set({ authHeader: '' }) : onClear('authHeader'))}
                className="mt-1 text-xs text-brand-600 hover:underline dark:text-brand-400"
              >
                {cleared ? 'Keep the stored value' : 'Clear stored value'}
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400">
            Requests go through the same outbound guard as the HTTP tool, so private and internal addresses are refused.
          </p>
        </>
      ) : (
        <>
          <Select
            label="Local server *"
            value={values.allowlistId || ''}
            onChange={(e) => set({ allowlistId: e.target.value })}
          >
            <option value="">{allowlist ? 'Select a server…' : 'Loading…'}</option>
            {(allowlist || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            {values.allowlistId && allowlist && !picked && (
              <option value={values.allowlistId}>{values.allowlistId} (no longer on the allowlist)</option>
            )}
          </Select>
          {picked?.description && <p className="text-xs text-slate-400">{picked.description}</p>}
          {allowlistError && <p className="text-xs text-red-500">{allowlistError}</p>}
          <p className="text-xs text-slate-400">
            Local servers are chosen by your operator in <code>server/mcp-servers.json</code>
            {isEdit ? '' : ' — you can pick one, not add one'}.
          </p>
        </>
      )}
    </div>
  );
}

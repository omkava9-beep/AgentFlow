import { useEffect, useState } from 'react';
import { listMcpAllowlist } from '../api/mcp';
import { Globe, Server, ShieldCheck } from 'lucide-react';
import { Field, Input, Select } from './ui/index';

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
    <fieldset className="space-y-4 rounded-card border border-default p-4">
      <legend className="px-1 text-2xs font-semibold uppercase tracking-wider text-subtle">MCP server</legend>

      <div role="radiogroup" aria-label="Transport" className="grid grid-cols-2 gap-2">
        {[
          ['http', 'Remote (HTTP)', 'A server reachable by URL', Globe],
          ['stdio', 'Local server', 'One your operator allowlisted', Server],
        ].map(([id, label, hintText, Icon]) => {
          const active = transport === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`mcp-transport-${id}`}
              onClick={() => set({ transport: id })}
              className={`flex items-start gap-2.5 rounded-card border p-3 text-left transition-colors ${
                active ? 'border-accent bg-accent-subtle/60 ring-1 ring-accent/30' : 'border-default hover:border-strong hover:bg-bg-subtle/60'
              }`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-accent' : 'text-subtle'}`} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">{label}</span>
                <span className="block text-xs text-subtle">{hintText}</span>
              </span>
            </button>
          );
        })}
      </div>

      {transport === 'http' ? (
        <>
          <Field label="Server URL" required htmlFor="mcp-url">
            <Input id="mcp-url" placeholder="https://mcp.example.com/mcp" value={values.url || ''} onChange={(e) => set({ url: e.target.value })} />
          </Field>
          <div className="grid grid-cols-5 gap-3">
            <Field label="Auth header name" htmlFor="mcp-header-name" className="col-span-2">
              <Input id="mcp-header-name" placeholder="Authorization" value={values.headerName || ''} onChange={(e) => set({ headerName: e.target.value })} />
            </Field>
            <Field
              label="Auth header value"
              htmlFor="mcp-auth-header"
              className="col-span-3"
              trailing={hint && onClear ? (
                <button
                  type="button"
                  onClick={() => (cleared ? set({ authHeader: '' }) : onClear('authHeader'))}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {cleared ? 'Keep stored value' : 'Clear stored value'}
                </button>
              ) : null}
            >
              <Input
                id="mcp-auth-header"
                type="password"
                autoComplete="new-password"
                value={cleared ? '' : values.authHeader || ''}
                disabled={cleared}
                placeholder={cleared ? 'Will be cleared on save' : hint ? `${hint} — leave blank to keep` : 'Bearer … (optional)'}
                onChange={(e) => set({ authHeader: e.target.value })}
              />
            </Field>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-subtle">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Requests go through the same outbound guard as the HTTP tool, so private and internal addresses are refused.
          </p>
        </>
      ) : (
        <>
          <Field label="Local server" required help={picked?.description}>
            <Select
              aria-label="Local server"
              value={values.allowlistId || ''}
              onValueChange={(v) => set({ allowlistId: v })}
              placeholder={allowlist ? 'Select a server…' : 'Loading…'}
              options={[
                ...(allowlist || []).map((srv) => ({ value: srv.id, label: srv.name, description: srv.description, icon: Server })),
                ...(values.allowlistId && allowlist && !picked
                  ? [{ value: values.allowlistId, label: `${values.allowlistId} (no longer on the allowlist)`, disabled: true }]
                  : []),
              ]}
            />
          </Field>
          {allowlistError && <p className="text-xs text-danger">{allowlistError}</p>}
          <p className="text-xs text-subtle">
            Local servers are chosen by your operator in <code className="font-mono">server/mcp-servers.json</code>
            {isEdit ? '' : ' — you can pick one, not add one'}.
          </p>
        </>
      )}
    </fieldset>
  );
}

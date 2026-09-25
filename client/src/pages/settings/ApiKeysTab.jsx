import { useCallback, useEffect, useState } from 'react';
import { listApiKeys, createApiKey, revokeApiKey, API_KEY_SCOPES } from '../../api/apiKeys';
import { apiErrorMessage } from '../../api/client';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useCan } from '../../hooks/useCan';
import { formatRelativeTime } from '../../utils/time';
import { Button, Card, ErrorText, TextField } from '../../components/ui';
import { confirm } from '../../components/ui/confirm';
import LastAuditChange from '../../components/LastAuditChange';

const API_BASE = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

function creatorLabel(createdBy) {
  if (!createdBy) return '—';
  if (typeof createdBy === 'string') return createdBy.slice(-6);
  return createdBy.name || createdBy.email || '—';
}

const when = (value) => (value ? formatRelativeTime(value) : '—');

function Modal({ children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        {children}
      </div>
    </div>
  );
}

function CreateKeyDialog({ workspaceId, onCreated, onClose }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState(['events:publish']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = (value) =>
    setScopes((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await createApiKey(workspaceId, { name: name.trim(), scopes });
      onCreated(result);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to create API key'));
      setBusy(false);
    }
  }

  return (
    <Modal>
      <form onSubmit={handleSubmit}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Create API key</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Keys let external systems publish events and start runs in this workspace.
        </p>
        <div className="mt-4 space-y-3">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Billing service" autoFocus required />
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Scopes</legend>
            <div className="space-y-1.5">
              {API_KEY_SCOPES.map((scope) => (
                <label key={scope.value} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={scopes.includes(scope.value)}
                    onChange={() => toggle(scope.value)}
                  />
                  <span>
                    <span className="font-mono text-xs">{scope.value}</span> — {scope.label}
                    <span className="block text-[11px] text-slate-400">{scope.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={busy || !name.trim() || scopes.length === 0}>
              {busy ? 'Creating...' : 'Create key'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Shown exactly once: the server stores only a hash, so this is the only copy. */
function ShowOnceDialog({ plaintext, slug, onClose }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Your new API key</h3>
      <p className="mt-2 text-sm font-medium text-amber-600 dark:text-amber-400">
        Copy it now — you won't see this key again.
      </p>
      <code className="mt-3 block break-all rounded-lg bg-slate-100 p-3 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
        {plaintext}
      </code>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Example:</p>
      <code className="mt-1 block whitespace-pre-wrap break-all rounded-lg bg-slate-100 p-2 font-mono text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
        {`curl -X POST ${API_BASE}/w/${slug}/events/order.created \\\n  -H "Authorization: Bearer ${plaintext}" \\\n  -H "Content-Type: application/json" -d '{}'`}
      </code>
      <div className="mt-4 flex gap-2">
        <Button type="button" className="flex-1" onClick={copy}>
          {copied ? 'Copied' : 'Copy key'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

/** Settings → API keys (spec/24). Owners and admins only (`apiKeys:manage`). */
export default function ApiKeysTab() {
  const current = useWorkspaceStore((s) => s.current);
  const allowed = useCan('apiKeys:manage');
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [plaintext, setPlaintext] = useState(null);

  const load = useCallback(() => {
    if (!current || !allowed) return;
    setLoading(true);
    listApiKeys(current.id)
      .then((data) => {
        setKeys(data);
        setError('');
      })
      .catch((err) => setError(apiErrorMessage(err, 'Failed to load API keys')))
      .finally(() => setLoading(false));
  }, [current, allowed]);

  useEffect(load, [load]);

  async function handleRevoke(key) {
    if (!(await confirm({ title: `Revoke "${key.name}"?`, body: 'Anything using this key will stop working immediately.', confirmLabel: 'Revoke key', destructive: true }))) return;
    try {
      await revokeApiKey(current.id, key.id);
      load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to revoke key'));
    }
  }

  if (!allowed) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Only owners and admins can manage API keys.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">API keys</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            For publishing events and starting runs from outside AgentFlow. Keys only work on this workspace.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Create key</Button>
      </div>
      <LastAuditChange action="apikey.*" refreshKey={keys} />

      <ErrorText>{error}</ErrorText>

      <Card className="overflow-hidden">
        {loading ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Loading...</p>
        ) : keys.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">No API keys yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Key</th>
                <th className="px-4 py-2 font-medium">Scopes</th>
                <th className="px-4 py-2 font-medium">Created by</th>
                <th className="px-4 py-2 font-medium">Last used</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {keys.map((key) => (
                <tr key={key.id} className={key.revokedAt ? 'opacity-50' : ''}>
                  <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-200">{key.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{key.prefix}…</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(key.scopes || []).map((s) => (
                        <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{creatorLabel(key.createdBy)}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{when(key.lastUsedAt)}</td>
                  <td className="px-4 py-2 text-right">
                    {key.revokedAt ? (
                      <span className="text-xs text-slate-400">Revoked {when(key.revokedAt)}</span>
                    ) : (
                      <button
                        onClick={() => handleRevoke(key)}
                        className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {creating && (
        <CreateKeyDialog
          workspaceId={current.id}
          onClose={() => setCreating(false)}
          onCreated={({ key }) => {
            setCreating(false);
            setPlaintext(key);
            load();
          }}
        />
      )}
      {plaintext && <ShowOnceDialog plaintext={plaintext} slug={current.slug} onClose={() => setPlaintext(null)} />}
    </div>
  );
}

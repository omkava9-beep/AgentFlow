import { useCallback, useEffect, useState } from 'react';
import { KeyRound, MoreHorizontal, Plus, ShieldAlert, Terminal, XCircle } from 'lucide-react';
import { listApiKeys, createApiKey, revokeApiKey, API_KEY_SCOPES } from '../../api/apiKeys';
import { apiErrorMessage } from '../../api/client';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useCan } from '../../hooks/useCan';
import { formatRelativeTime } from '../../utils/time';
import {
  Avatar, Badge, Button, Checkbox, CopyButton, DataTable, Dialog, EmptyState, Field, Input, Menu, MenuButton, confirm,
} from '../../components/ui/index';
import LastAuditChange from '../../components/LastAuditChange';
import SettingsCard from './SettingsCard';

const API_BASE = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

function creator(createdBy) {
  if (!createdBy) return null;
  if (typeof createdBy === 'string') return { name: createdBy.slice(-6) };
  return { name: createdBy.name || createdBy.email, email: createdBy.email };
}

const when = (value) => (value ? formatRelativeTime(value) : 'Never');

function CreateKeyDialog({ workspaceId, onCreated, onClose }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState(['events:publish']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = (value, on) => setScopes((prev) => (on ? [...new Set([...prev, value])] : prev.filter((s) => s !== value)));

  async function handleSubmit(e) {
    e?.preventDefault();
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
    <Dialog
      open
      onClose={onClose}
      dismissable={!busy}
      title="Create API key"
      description="Keys let external systems publish events and start runs in this workspace."
      icon={KeyRound}
      testId="create-key-dialog"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="create-key-form" loading={busy} disabled={!name.trim() || scopes.length === 0}>Create key</Button>
        </>
      )}
    >
      <form id="create-key-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name" required htmlFor="key-name" help="Something that says where it's used.">
          <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Billing service" autoFocus />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg">Scopes</legend>
          <div className="divide-y divide-default rounded-card border border-default">
            {API_KEY_SCOPES.map((scope) => (
              <div key={scope.value} className="px-3 py-2.5">
                <Checkbox
                  checked={scopes.includes(scope.value)}
                  onCheckedChange={(on) => toggle(scope.value, on)}
                  label={<span className="flex items-center gap-2">{scope.label} <code className="font-mono text-2xs text-subtle">{scope.value}</code></span>}
                  description={<code className="font-mono text-2xs">{scope.hint}</code>}
                />
              </div>
            ))}
          </div>
          {scopes.length === 0 && <p className="mt-1.5 text-xs text-danger">Pick at least one scope.</p>}
        </fieldset>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}

/** Shown exactly once: the server stores only a hash, so this is the only copy. */
function ShowOnceDialog({ plaintext, slug, onClose }) {
  const example = `curl -X POST ${API_BASE}/w/${slug}/events/order.created \\\n  -H "Authorization: Bearer ${plaintext}" \\\n  -H "Content-Type: application/json" -d '{}'`;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Your new API key"
      icon={KeyRound}
      size="lg"
      testId="show-once-dialog"
      footer={(
        <>
          <CopyButton value={plaintext} label="Copy key" />
          <Button onClick={onClose}>Done</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-card border border-warning/30 bg-warning-subtle px-3.5 py-2.5 text-sm font-medium text-warning-subtle-fg">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Copy it now — you won&rsquo;t see this key again.
        </div>
        <div className="flex items-center gap-2">
          <code className="block min-w-0 flex-1 break-all rounded-control border border-default bg-surface-sunken p-3 font-mono text-xs text-fg">{plaintext}</code>
          <CopyButton value={plaintext} />
        </div>
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Terminal className="h-3.5 w-3.5" aria-hidden="true" /> Example
          </p>
          <pre className="overflow-x-auto whitespace-pre rounded-control border border-default bg-surface-sunken p-3 font-mono text-2xs text-muted">{example}</pre>
        </div>
      </div>
    </Dialog>
  );
}

/** Settings → API keys (spec/24). Owners and admins only (`apiKeys:manage`). */
export default function ApiKeysTab() {
  const current = useWorkspaceStore((s) => s.current);
  const allowed = useCan('apiKeys:manage');
  const [keys, setKeys] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [plaintext, setPlaintext] = useState(null);

  const load = useCallback(() => {
    if (!current || !allowed) return;
    listApiKeys(current.id)
      .then((data) => { setKeys(data); setError(''); })
      .catch((err) => { setError(apiErrorMessage(err, 'Failed to load API keys')); setKeys((k) => k || []); });
  }, [current, allowed]);

  useEffect(load, [load]);

  async function handleRevoke(key) {
    if (!(await confirm({ title: `Revoke “${key.name}”?`, body: 'Anything using this key will stop working immediately.', confirmLabel: 'Revoke key', destructive: true }))) return;
    try {
      await revokeApiKey(current.id, key.id);
      load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to revoke key'));
    }
  }

  if (!allowed) {
    return <EmptyState icon={KeyRound} title="Owners and admins only" body="Only owners and admins can manage API keys." compact />;
  }

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      cell: (k) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{k.name}</div>
          <code className="font-mono text-2xs text-subtle">{k.prefix}…</code>
        </div>
      ),
    },
    {
      key: 'scopes',
      header: 'Scopes',
      cell: (k) => (
        <div className="flex flex-wrap gap-1">
          {(k.scopes || []).map((s) => <Badge key={s} size="xs" className="font-mono">{s}</Badge>)}
        </div>
      ),
    },
    {
      key: 'createdBy',
      header: 'Created by',
      width: 170,
      cell: (k) => {
        const who = creator(k.createdBy);
        return who ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={who.name} email={who.email} size="xs" />
            <span className="truncate text-sm text-muted">{who.name}</span>
          </span>
        ) : <span className="text-subtle">—</span>;
      },
    },
    {
      key: 'lastUsedAt',
      header: 'Last used',
      width: 130,
      sortable: true,
      cell: (k) => <span className="text-sm text-subtle">{when(k.lastUsedAt)}</span>,
    },
    {
      key: 'state',
      header: 'Status',
      width: 150,
      cell: (k) => (k.revokedAt
        ? <Badge tone="neutral">Revoked {formatRelativeTime(k.revokedAt)}</Badge>
        : <Badge tone="success" dot>Active</Badge>),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 52,
      align: 'right',
      cell: (k) => (k.revokedAt ? null : (
        <Menu
          align="right"
          title={`Actions for ${k.name}`}
          label={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
          buttonClassName="inline-flex h-7 w-7 items-center justify-center rounded-control text-subtle transition-colors hover:bg-bg-subtle hover:text-fg"
        >
          <MenuButton danger onClick={() => handleRevoke(k)}><XCircle className="h-4 w-4" /> Revoke</MenuButton>
        </Menu>
      )),
    },
  ];

  return (
    <div className="space-y-4">
      <SettingsCard
        title="API keys"
        description="For publishing events and starting runs from outside AgentFlow. A key only works on this workspace."
        flush={!(keys && keys.length === 0)}
        footer={<Button icon={Plus} onClick={() => setCreating(true)}>Create key</Button>}
      >
        {keys && keys.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-subtle"><KeyRound className="h-4 w-4" aria-hidden="true" /> No API keys yet.</p>
        ) : (
          <DataTable
            className="!rounded-none !border-0"
            columns={columns}
            rows={keys}
            loading={!keys}
            loadingRows={2}
            rowClassName={(k) => (k.revokedAt ? 'opacity-60' : '')}
          />
        )}
      </SettingsCard>
      <LastAuditChange action="apikey.*" refreshKey={keys} />
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      {creating && (
        <CreateKeyDialog
          workspaceId={current.id}
          onClose={() => setCreating(false)}
          onCreated={({ key }) => { setCreating(false); setPlaintext(key); load(); }}
        />
      )}
      {plaintext && <ShowOnceDialog plaintext={plaintext} slug={current.slug} onClose={() => setPlaintext(null)} />}
    </div>
  );
}

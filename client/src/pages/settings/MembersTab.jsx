import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listMembers, updateMemberRole, removeMember, getSeats } from '../../api/members';
import { listInvitations, createInvitation, resendInvitation, revokeInvitation } from '../../api/invitations';
import { apiErrorMessage } from '../../api/client';
import { useWorkspaceStore, workspacePath } from '../../store/workspaceStore';
import { useAuthStore } from '../../store/authStore';
import { useToastStore } from '../../store/toastStore';
import { can, invitableRoles, memberActions } from '../../hooks/useCan';
import { Card, Button, TextField, Select, ErrorText } from '../../components/ui';
import RoleBadge from '../../components/RoleBadge';
import LastAuditChange from '../../components/LastAuditChange';
import { formatRelativeTime } from '../../utils/time';
import { confirm } from '../../components/ui/confirm';
import { useWorkspacePath } from '../../hooks/useWorkspacePath';

const invId = (inv) => inv.id || inv._id;

function CopyButton({ text, label = 'Copy link' }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this link:', text);
    }
  }
  return (
    <Button type="button" variant="secondary" className="px-3 py-1 text-xs" onClick={copy}>
      {copied ? 'Copied' : label}
    </Button>
  );
}

export default function MembersTab() {
  const current = useWorkspaceStore((s) => s.current);
  const selfId = useAuthStore((s) => s.user?.id);
  const navigate = useNavigate();
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  // Only a hash of each invite token is stored, so the list can't return links.
  // A link is known only for invites created in this session; for the rest,
  // "Copy new link" resends (rotating the token) and copies the fresh one.
  const [links, setLinks] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviting, setInviting] = useState(false);

  const canInvite = can(current, 'members:invite');

  const load = useCallback(async () => {
    if (!current) return;
    setError('');
    try {
      const [m, inv] = await Promise.all([
        listMembers(current.id),
        canInvite ? listInvitations(current.id) : Promise.resolve([]),
      ]);
      setMembers(m);
      setInvitations(inv.filter((i) => !i.status || i.status === 'pending'));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load members'));
    } finally {
      setLoading(false);
    }
  }, [current, canInvite]);

  useEffect(() => {
    load();
  }, [load]);

  if (!current) return null;

  async function changeRole(member, role) {
    setError('');
    try {
      await updateMemberRole(current.id, member.userId, role);
      await load();
      // Changing your own role changes what this UI may show.
      if (member.userId === selfId) await useWorkspaceStore.getState().refreshWorkspaces();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to change role'));
    }
  }

  async function remove(member) {
    const isSelf = member.userId === selfId;
    const prompt = isSelf
      ? `Leave “${current.name}”? You'll lose access to its workflows and runs.`
      : `Remove ${member.name || member.email} from “${current.name}”?`;
    if (!(await confirm({ title: prompt, confirmLabel: isSelf ? 'Leave workspace' : 'Remove member', destructive: true }))) return;
    setError('');
    try {
      await removeMember(current.id, member.userId);
      if (isSelf) {
        const store = useWorkspaceStore.getState();
        store.removeWorkspace(current.id);
        const list = await store.refreshWorkspaces().catch(() => store.workspaces);
        const fallback = list.find((w) => w.personal) || list[0];
        useToastStore.getState().push(`You left “${current.name}”.`, 'success');
        navigate(fallback ? workspacePath(fallback.slug, '/dashboard') : '/');
        return;
      }
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, isSelf ? 'Failed to leave workspace' : 'Failed to remove member'));
    }
  }

  async function copyNewLink(inv) {
    setError('');
    try {
      const { invitation, inviteUrl } = await resendInvitation(current.id, invId(inv));
      setLinks((l) => ({ ...l, [invId(inv)]: inviteUrl }));
      if (invitation) setInvitations((list) => list.map((i) => (invId(i) === invId(inv) ? invitation : i)));
      try {
        await navigator.clipboard.writeText(inviteUrl);
        useToastStore.getState().push(`New link for ${inv.email} copied — the old one no longer works.`, 'success');
      } catch {
        window.prompt('Copy this link (the old one no longer works):', inviteUrl);
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to generate a new invite link'));
    }
  }

  async function revoke(inv) {
    if (!(await confirm({ title: `Revoke the invite for ${inv.email}?`, body: 'The link stops working immediately.', confirmLabel: 'Revoke invite', destructive: true }))) return;
    setError('');
    try {
      await revokeInvitation(current.id, invId(inv));
      setInvitations((list) => list.filter((i) => invId(i) !== invId(inv)));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to revoke invite'));
    }
  }

  function onInvited({ invitation, inviteUrl }) {
    setInvitations((list) => [invitation, ...list.filter((i) => invId(i) !== invId(invitation))]);
    setLinks((l) => ({ ...l, [invId(invitation)]: inviteUrl }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </p>
        {canInvite && <Button onClick={() => setInviting(true)}>Invite people</Button>}
      </div>
      <LastAuditChange action="member.*" refreshKey={members} />

      <ErrorText>{error}</ErrorText>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Loading members...</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
              <tr>
                <th className="px-4 py-2 font-medium">Member</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Joined</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {members.map((m) => {
                const actions = memberActions(current, m, selfId);
                return (
                  <tr key={m.userId}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800 dark:text-slate-100">
                        {m.name || m.email}
                        {m.userId === selfId && <span className="ml-1 text-xs font-normal text-slate-400">(you)</span>}
                      </div>
                      {m.name && <div className="text-xs text-slate-500 dark:text-slate-400">{m.email}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {actions.canChangeRole ? (
                        <select
                          value={m.role}
                          onChange={(e) => changeRole(m, e.target.value)}
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs capitalize dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        >
                          {[...new Set([m.role, ...actions.roles])].map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <RoleBadge role={m.role} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                      {m.joinedAt ? formatRelativeTime(m.joinedAt) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {actions.canRemove && (
                        <Button variant="ghost" className="px-2 py-1 text-xs text-red-600 dark:text-red-400" onClick={() => remove(m)}>
                          Remove
                        </Button>
                      )}
                      {actions.canLeave && (
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => remove(m)}>
                          Leave
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {canInvite && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Pending invites</h2>
          {invitations.length === 0 ? (
            <Card className="p-4 text-sm text-slate-500 dark:text-slate-400">No pending invites.</Card>
          ) : (
            <Card className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
              {invitations.map((inv) => {
                const expired = inv.status === 'expired' || (inv.expiresAt && new Date(inv.expiresAt) < new Date());
                const link = links[invId(inv)];
                return (
                  <div key={invId(inv)} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                        <span className="truncate">{inv.email}</span>
                        <RoleBadge role={inv.role} />
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {expired
                          ? 'Expired — copy a new link to re-issue it'
                          : inv.expiresAt
                            ? `Expires ${new Date(inv.expiresAt).toLocaleDateString()}`
                            : 'Pending'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {link && !expired && <CopyButton text={link} />}
                      <Button
                        variant="secondary"
                        className="px-3 py-1 text-xs"
                        onClick={() => copyNewLink(inv)}
                        title="Generates a fresh link and extends the expiry; the old link stops working"
                      >
                        Copy new link
                      </Button>
                      <Button variant="ghost" className="px-2 py-1 text-xs text-red-600 dark:text-red-400" onClick={() => revoke(inv)}>
                        Revoke
                      </Button>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      )}

      {inviting && <InviteDialog workspace={current} onInvited={onInvited} onClose={() => setInviting(false)} />}
    </div>
  );
}

function InviteDialog({ workspace, onInvited, onClose }) {
  const roles = invitableRoles(workspace);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roles.includes('editor') ? 'editor' : roles[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(null);
  const [seats, setSeats] = useState(null);
  const wp = useWorkspacePath();

  // The plan's member limit (spec/33 §6) is checked by the server too; this is
  // so the dialog can say why instead of failing after the user types an email.
  useEffect(() => {
    let cancelled = false;
    getSeats(workspace.id).then((s) => !cancelled && setSeats(s)).catch(() => {});
    return () => { cancelled = true; };
  }, [workspace.id, sent]);
  const atLimit = Boolean(seats?.atLimit);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await createInvitation(workspace.id, { email: email.trim(), role });
      onInvited(result);
      setSent(result);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to send invite'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Invite to {workspace.name}</h3>
        {sent ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Invite created for <span className="font-medium">{sent.invitation?.email}</span>. No email is actually sent —
              share this link with them (it also appears in their Outbox once they sign up):
            </p>
            <code className="block break-all rounded-lg bg-slate-100 p-2 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {sent.inviteUrl}
            </code>
            <p className="text-xs text-slate-400">The link expires in 7 days and can only be used by that email address.</p>
            <div className="flex gap-2">
              <CopyButton text={sent.inviteUrl} />
              <Button
                type="button"
                variant="secondary"
                className="px-3 py-1 text-xs"
                onClick={() => {
                  setSent(null);
                  setEmail('');
                }}
              >
                Invite another
              </Button>
              <Button type="button" className="ml-auto px-3 py-1 text-xs" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              autoFocus
              required
            />
            <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)} className="capitalize">
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            {atLimit && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" data-testid="seat-limit-note">
                The {seats.plan?.name} plan allows {seats.seatLimit} members, and all {seats.seatsUsed} seats are taken
                (pending invites count). <Link to={wp('/settings/usage')} className="font-medium underline">Change plan</Link>{' '}
                or revoke a pending invite to free a seat. Resending an existing invite from the list still works.
              </p>
            )}
            <ErrorText>{error}</ErrorText>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={busy || !email.trim() || atLimit}>
                {busy ? 'Creating...' : 'Create invite'}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Clock, Link2, LogOut, MailPlus, MoreHorizontal, RotateCw, TriangleAlert, UserMinus, Users, XCircle } from 'lucide-react';
import { listMembers, updateMemberRole, removeMember, getSeats } from '../../api/members';
import { listInvitations, createInvitation, resendInvitation, revokeInvitation } from '../../api/invitations';
import { apiErrorMessage } from '../../api/client';
import { useWorkspaceStore, workspacePath } from '../../store/workspaceStore';
import { useAuthStore } from '../../store/authStore';
import { useToastStore } from '../../store/toastStore';
import { can, invitableRoles, memberActions } from '../../hooks/useCan';
import {
  Avatar, Badge, Button, CopyButton, DataTable, Dialog, Field, Input, Menu, MenuButton, MenuSeparator, Select, Tooltip, confirm, prompt,
} from '../../components/ui/index';
import RoleBadge from '../../components/RoleBadge';
import LastAuditChange from '../../components/LastAuditChange';
import { formatRelativeTime, formatUntil } from '../../utils/time';
import { useWorkspacePath } from '../../hooks/useWorkspacePath';
import SettingsCard from './SettingsCard';

const invId = (inv) => inv.id || inv._id;
const toast = (msg, tone) => useToastStore.getState().push(msg, tone);

const ROLE_INFO = {
  owner: 'Full control, including billing and deleting the workspace',
  admin: 'Manage members, connections, API keys and settings',
  editor: 'Build, publish and run workflows',
  viewer: 'Read-only — can comment and approve when assigned',
};
const roleOption = (r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1), description: ROLE_INFO[r] });

/** Clipboard first; if the browser blocks it, show the link in a copyable dialog. */
async function copyOrShow(text, title) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    await prompt({ title, label: 'Link', defaultValue: text, readOnly: true, copy: true });
    return false;
  }
}

export default function MembersTab() {
  const current = useWorkspaceStore((s) => s.current);
  const selfId = useAuthStore((s) => s.user?.id);
  const navigate = useNavigate();
  const [members, setMembers] = useState(null);
  const [invitations, setInvitations] = useState([]);
  // Only a hash of each invite token is stored, so the list can't return links.
  // A link is known only for invites created in this session; for the rest,
  // "Copy new link" resends (rotating the token) and copies the fresh one.
  const [links, setLinks] = useState({});
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
      setInvitations(inv.filter((i) => !i.status || i.status === 'pending' || i.status === 'expired'));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load members'));
      setMembers((prev) => prev || []);
    }
  }, [current, canInvite]);

  useEffect(() => { load(); }, [load]);

  if (!current) return null;

  async function changeRole(member, role) {
    if (role === member.role) return;
    setError('');
    try {
      await updateMemberRole(current.id, member.userId, role);
      await load();
      toast(`${member.name || member.email} is now ${role === 'admin' ? 'an' : 'a'} ${role}.`, 'success');
      // Changing your own role changes what this UI may show.
      if (member.userId === selfId) await useWorkspaceStore.getState().refreshWorkspaces();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to change role'));
    }
  }

  async function remove(member) {
    const isSelf = member.userId === selfId;
    const title = isSelf
      ? `Leave “${current.name}”?`
      : `Remove ${member.name || member.email} from “${current.name}”?`;
    const body = isSelf ? "You'll lose access to its workflows and runs." : 'They lose access immediately. Their workflows and runs stay.';
    if (!(await confirm({ title, body, confirmLabel: isSelf ? 'Leave workspace' : 'Remove member', destructive: true }))) return;
    setError('');
    try {
      await removeMember(current.id, member.userId);
      if (isSelf) {
        const store = useWorkspaceStore.getState();
        store.removeWorkspace(current.id);
        const list = await store.refreshWorkspaces().catch(() => store.workspaces);
        const fallback = list.find((w) => w.personal) || list[0];
        toast(`You left “${current.name}”.`, 'success');
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
      if (await copyOrShow(inviteUrl, `New invite link for ${inv.email}`)) {
        toast(`New link for ${inv.email} copied — the old one no longer works.`, 'success');
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

  const memberColumns = [
    {
      key: 'member',
      header: 'Member',
      sortable: true,
      sortValue: (m) => (m.name || m.email).toLowerCase(),
      cell: (m) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={m.name} email={m.email} size="md" />
          <div className="min-w-0">
            <div className="truncate font-medium text-fg">
              {m.name || m.email}
              {m.userId === selfId && <span className="ml-1.5 text-xs font-normal text-subtle">(you)</span>}
            </div>
            {m.name && <div className="truncate text-xs text-subtle">{m.email}</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      width: 190,
      sortable: true,
      cell: (m) => {
        const actions = memberActions(current, m, selfId);
        return actions.canChangeRole ? (
          <Select
            size="sm"
            aria-label={`Role for ${m.name || m.email}`}
            value={m.role}
            onValueChange={(r) => changeRole(m, r)}
            options={[...new Set([m.role, ...actions.roles])].map(roleOption)}
          />
        ) : <RoleBadge role={m.role} />;
      },
    },
    {
      key: 'joinedAt',
      header: 'Joined',
      width: 130,
      sortable: true,
      cell: (m) => <span className="text-sm text-subtle">{m.joinedAt ? formatRelativeTime(m.joinedAt) : '—'}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 96,
      align: 'right',
      cell: (m) => {
        const actions = memberActions(current, m, selfId);
        if (actions.canLeave) {
          return <Button variant="ghost" size="sm" icon={LogOut} onClick={() => remove(m)}>Leave</Button>;
        }
        if (!actions.canRemove) return null;
        return (
          <Menu
            align="right"
            title={`Actions for ${m.name || m.email}`}
            label={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
            buttonClassName="inline-flex h-7 w-7 items-center justify-center rounded-control text-subtle transition-colors hover:bg-bg-subtle hover:text-fg"
          >
            <MenuButton danger onClick={() => remove(m)}><UserMinus className="h-4 w-4" /> Remove from workspace</MenuButton>
          </Menu>
        );
      },
    },
  ];

  const inviteColumns = [
    {
      key: 'email',
      header: 'Invited',
      cell: (inv) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-strong text-subtle">
            <MailPlus className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span className="truncate font-medium text-fg">{inv.email}</span>
        </div>
      ),
    },
    { key: 'role', header: 'Role', width: 190, cell: (inv) => <RoleBadge role={inv.role} /> },
    {
      key: 'status',
      header: 'Status',
      width: 220,
      cell: (inv) => {
        const expired = inv.status === 'expired' || (inv.expiresAt && new Date(inv.expiresAt) < new Date());
        return expired
          ? <Badge tone="warning" icon={TriangleAlert}>Expired — send a new link</Badge>
          : <span className="inline-flex items-center gap-1.5 text-sm text-muted"><Clock className="h-3.5 w-3.5 text-subtle" aria-hidden="true" />{inv.expiresAt ? `Expires ${formatUntil(inv.expiresAt)}` : 'Pending'}</span>;
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 230,
      align: 'right',
      cell: (inv) => {
        const expired = inv.status === 'expired' || (inv.expiresAt && new Date(inv.expiresAt) < new Date());
        const link = links[invId(inv)];
        return (
          <div className="flex items-center justify-end gap-1.5">
            {link && !expired && <CopyButton value={link} label="Copy link" size="xs" />}
            <Tooltip content="Generates a fresh link and extends the expiry; the old link stops working">
              <Button variant="secondary" size="xs" icon={RotateCw} onClick={() => copyNewLink(inv)}>Copy new link</Button>
            </Tooltip>
            <Menu
              align="right"
              title={`More for ${inv.email}`}
              label={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
              buttonClassName="inline-flex h-7 w-7 items-center justify-center rounded-control text-subtle transition-colors hover:bg-bg-subtle hover:text-fg"
            >
              {link && <MenuButton onClick={() => copyOrShow(link, `Invite link for ${inv.email}`)}><Link2 className="h-4 w-4" /> Copy current link</MenuButton>}
              {link && <MenuSeparator />}
              <MenuButton danger onClick={() => revoke(inv)}><XCircle className="h-4 w-4" /> Revoke</MenuButton>
            </Menu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Members"
        description={members ? `${members.length} ${members.length === 1 ? 'person has' : 'people have'} access to ${current.name}.` : 'People with access to this workspace.'}
        flush
        footer={canInvite ? <Button icon={MailPlus} onClick={() => setInviting(true)}>Invite people</Button> : null}
      >
        <DataTable
          className="!rounded-none !border-0"
          columns={memberColumns}
          rows={members}
          rowKey={(m) => m.userId}
          loading={!members}
          loadingRows={3}
          initialSort={{ key: 'member', dir: 'asc' }}
        />
      </SettingsCard>
      <LastAuditChange action="member.*" refreshKey={members} />
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      {canInvite && (
        <SettingsCard
          title="Pending invites"
          description="Invites are links, not emails — share them yourself. They expire after 7 days and only work for the invited address."
          flush={invitations.length > 0}
        >
          {invitations.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-subtle">
              <Users className="h-4 w-4" aria-hidden="true" /> No pending invites.
            </p>
          ) : (
            <DataTable className="!rounded-none !border-0" columns={inviteColumns} rows={invitations} rowKey={invId} dense />
          )}
        </SettingsCard>
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
    e?.preventDefault();
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
    <Dialog
      open
      onClose={onClose}
      dismissable={!busy}
      title={sent ? 'Invite link ready' : `Invite to ${workspace.name}`}
      description={sent ? undefined : 'They get a link to join with the role you pick.'}
      icon={MailPlus}
      size="md"
      testId="invite-dialog"
      footer={sent ? (
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => { setSent(null); setEmail(''); }}>Invite another</Button>
          <CopyButton value={sent.inviteUrl} label="Copy link" />
          <Button onClick={onClose}>Done</Button>
        </>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="invite-form" loading={busy} disabled={!email.trim() || atLimit}>Create invite</Button>
        </>
      )}
    >
      {sent ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Invite created for <span className="font-medium text-fg">{sent.invitation?.email}</span>. No email is sent —
            share this link with them. It also appears in their Outbox once they sign up.
          </p>
          <code className="block break-all rounded-control border border-default bg-surface-sunken p-3 font-mono text-xs text-fg">
            {sent.inviteUrl}
          </code>
          <p className="text-xs text-subtle">The link expires in 7 days and only works for that email address.</p>
        </div>
      ) : (
        <form id="invite-form" onSubmit={handleSubmit} className="space-y-4">
          <Field label="Email" required htmlFor="invite-email">
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" autoFocus />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <Select id="invite-role" aria-label="Role" value={role} onValueChange={setRole} options={roles.map(roleOption)} />
          </Field>
          {atLimit && (
            <div className="flex items-start gap-2.5 rounded-card border border-warning/30 bg-warning-subtle px-3.5 py-2.5 text-sm text-warning-subtle-fg" data-testid="seat-limit-note">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                The {seats.plan?.name} plan allows {seats.seatLimit} members, and all {seats.seatsUsed} seats are taken
                (pending invites count). <Link to={wp('/settings/usage')} className="font-medium underline">Change plan</Link>{' '}
                or revoke a pending invite to free a seat. Resending an existing invite still works.
              </p>
            </div>
          )}
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        </form>
      )}
    </Dialog>
  );
}

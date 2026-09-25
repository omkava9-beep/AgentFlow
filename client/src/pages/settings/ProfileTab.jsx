import { useState } from 'react';
import { updateMe, changePassword, revokeOtherSessions } from '../../api/auth';
import { apiErrorMessage } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { useToastStore } from '../../store/toastStore';
import { LogOut } from 'lucide-react';
import { Avatar, Button, Field, Input, confirm } from '../../components/ui/index';
import SettingsCard from './SettingsCard';

const MIN_PASSWORD = 6;

/**
 * The signed-in user's own settings (spec/36 §4). It lives under Settings for
 * discoverability, but belongs to the user and applies in every workspace.
 */
export default function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Avatar name={user.name} email={user.email} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-fg">{user.name || user.email}</p>
          <p className="text-sm text-muted">Your profile applies across all your workspaces.</p>
        </div>
      </div>
      <NameCard user={user} />
      <PasswordCard />
      <SessionsCard />
    </div>
  );
}

/** Keeps the stored session in step: same token, updated user. */
function setUser(user) {
  const { token, login } = useAuthStore.getState();
  login(token, user);
}

/** A password change or revoke hands back a new token; the old one is dead. */
function setToken(token) {
  const { user, login } = useAuthStore.getState();
  login(token, user);
}

function NameCard({ user }) {
  const [name, setName] = useState(user.name || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = name.trim() && name.trim() !== user.name;

  async function handleSave(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const updated = await updateMe(name.trim());
      setUser({ ...user, ...updated });
      useToastStore.getState().push('Name updated.', 'success');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to update your name'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSave}>
      <SettingsCard
        title="Profile"
        description="How you appear to teammates in comments, presence and the audit log."
        footer={<Button type="submit" loading={busy} disabled={!dirty}>Save name</Button>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required htmlFor="profile-name">
            <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Email" htmlFor="profile-email" help="Your sign-in; it can't be changed here.">
            <Input id="profile-email" value={user.email} disabled readOnly />
          </Field>
        </div>
        {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      </SettingsCard>
    </form>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mismatch = again && next !== again;
  const tooShort = next && next.length < MIN_PASSWORD;

  async function handleSubmit(e) {
    e.preventDefault();
    if (mismatch || tooShort) return;
    setBusy(true);
    setError('');
    try {
      const { token } = await changePassword(current, next);
      setToken(token);
      setCurrent('');
      setNext('');
      setAgain('');
      useToastStore.getState().push('Password changed. Your other sessions were signed out.', 'success');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to change password'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <SettingsCard
        title="Change password"
        description="Changing your password signs you out everywhere else. This browser stays signed in."
        footer={(
          <Button type="submit" loading={busy} disabled={!current || !next || !again || mismatch || tooShort}>
            Change password
          </Button>
        )}
      >
        <div className="grid max-w-md gap-4">
          <Field label="Current password" required htmlFor="pw-current">
            <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" required htmlFor="pw-next" error={tooShort ? `At least ${MIN_PASSWORD} characters.` : undefined} help={`At least ${MIN_PASSWORD} characters.`}>
            <Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} invalid={Boolean(tooShort)} />
          </Field>
          <Field label="Confirm new password" required htmlFor="pw-again" error={mismatch ? "The new passwords don't match." : undefined}>
            <Input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} invalid={Boolean(mismatch)} />
          </Field>
        </div>
        {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      </SettingsCard>
    </form>
  );
}

function SessionsCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleRevoke() {
    const ok = await confirm({
      title: 'Sign out of all other sessions?',
      body: 'Every other browser and device signed in to your account will be signed out on its next request. This one stays signed in.',
      confirmLabel: 'Sign out others',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      const { token } = await revokeOtherSessions();
      setToken(token);
      useToastStore.getState().push('Signed out of all other sessions.', 'success');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to sign out other sessions'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard
      title="Sessions"
      description="Lost a laptop or signed in on a shared computer? Sign out everywhere except here."
      footer={<Button variant="secondary" icon={LogOut} loading={busy} onClick={handleRevoke}>Sign out of all other sessions</Button>}
    >
      <p className="text-sm text-muted">Every other browser and device is signed out on its next request.</p>
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
    </SettingsCard>
  );
}

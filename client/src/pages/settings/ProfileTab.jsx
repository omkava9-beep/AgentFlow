import { useState } from 'react';
import { updateMe, changePassword, revokeOtherSessions } from '../../api/auth';
import { apiErrorMessage } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { useToastStore } from '../../store/toastStore';
import { confirm } from '../../components/ui/confirm';
import { Card, Button, TextField, ErrorText } from '../../components/ui';

const MIN_PASSWORD = 6;

/**
 * The signed-in user's own settings (spec/36 §4). It lives under Settings for
 * discoverability, but belongs to the user and applies in every workspace.
 */
export default function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-slate-500 dark:text-slate-400">Your profile applies across all your workspaces.</p>
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
    <Card className="p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Profile</h2>
      <form onSubmit={handleSave} className="space-y-4">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        <div>
          <TextField label="Email" value={user.email} disabled readOnly />
          <p className="mt-1 text-xs text-slate-400">Your email is your sign-in and can't be changed here.</p>
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy || !dirty}>{busy ? 'Saving...' : 'Save name'}</Button>
      </form>
    </Card>
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
    <Card className="p-5">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">Change password</h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Changing your password signs you out everywhere else. This browser stays signed in.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        <TextField label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        <TextField label="Confirm new password" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
        {tooShort && <p className="text-xs text-amber-600">At least {MIN_PASSWORD} characters.</p>}
        {mismatch && <p className="text-xs text-amber-600">The new passwords don't match.</p>}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy || !current || !next || !again || mismatch || tooShort}>
          {busy ? 'Changing...' : 'Change password'}
        </Button>
      </form>
    </Card>
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
    <Card className="p-5">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">Sessions</h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Lost a laptop or signed in on a shared computer? Sign out everywhere except here.
      </p>
      <ErrorText>{error}</ErrorText>
      <Button variant="secondary" onClick={handleRevoke} disabled={busy}>
        {busy ? 'Signing out...' : 'Sign out of all other sessions'}
      </Button>
    </Card>
  );
}

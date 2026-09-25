import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getInvitation, acceptInvitation } from '../api/invitations';
import { apiErrorMessage } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore, workspacePath } from '../store/workspaceStore';
import { useToastStore } from '../store/toastStore';
import { Card, Button, ErrorText } from '../components/ui';
import { Wordmark } from '../components/Logo';
import ThemeToggle from '../components/ThemeToggle';
import RoleBadge from '../components/RoleBadge';

/**
 * `/invite/:token` (spec/23). Public, like the share page: the invitee may not
 * have an account yet. Accepting requires being signed in as the invited email,
 * so a forwarded link can't be used by someone else.
 */
export default function InvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { token: authToken, user, logout } = useAuthStore();
  const [invite, setInvite] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | invalid | expired
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getInvitation(token)
      .then((data) => {
        setInvite(data);
        setState(data.status === 'expired' ? 'expired' : data.status && data.status !== 'pending' ? 'invalid' : 'ready');
      })
      .catch((err) => setState(err?.response?.status === 410 ? 'expired' : 'invalid'));
  }, [token]);

  const next = `/invite/${token}`;
  const authQuery = invite ? `?email=${encodeURIComponent(invite.email)}&next=${encodeURIComponent(next)}` : `?next=${encodeURIComponent(next)}`;
  const signedIn = Boolean(authToken && user);
  const rightAccount = signedIn && invite && user.email?.toLowerCase() === invite.email?.toLowerCase();

  async function handleAccept() {
    setBusy(true);
    setError('');
    try {
      const { workspace } = await acceptInvitation(token);
      const store = useWorkspaceStore.getState();
      if (workspace) store.upsertWorkspace(workspace);
      await store.refreshWorkspaces().catch(() => {});
      useToastStore.getState().push(`You joined “${workspace?.name || invite.workspaceName}”.`, 'success');
      navigate(workspace ? workspacePath(workspace.slug, '/dashboard') : '/');
    } catch (err) {
      const status = err?.response?.status;
      if (status === 410) setState('expired');
      else if (status === 404) setState('invalid');
      else setError(apiErrorMessage(err, 'Could not accept this invite'));
      setBusy(false);
    }
  }

  function switchAccount() {
    logout();
    navigate(`/login${authQuery}`);
  }

  let body;
  if (state === 'loading') {
    body = <p className="text-sm text-slate-500 dark:text-slate-400">Loading invite...</p>;
  } else if (state === 'invalid' || state === 'expired') {
    body = (
      <>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {state === 'expired' ? 'This invite has expired' : 'This invite is no longer valid'}
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {state === 'expired'
            ? 'Invites last 7 days. Ask whoever invited you to send a new one.'
            : 'It may have been revoked, replaced by a newer link, or already used.'}
        </p>
        <Link to="/" className="mt-4 inline-block text-sm text-brand-600 hover:underline dark:text-brand-400">
          Go to AgentFlow
        </Link>
      </>
    );
  } else {
    body = (
      <>
        <p className="text-sm text-slate-500 dark:text-slate-400">You've been invited</p>
        <h1 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
          {invite.invitedByName ? `${invite.invitedByName} invited you to ` : 'Join '}
          <span className="text-brand-600 dark:text-brand-400">{invite.workspaceName}</span>
        </h1>
        <p className="mt-2 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          as <RoleBadge role={invite.role} /> · for {invite.email}
        </p>

        <div className="mt-6 space-y-3">
          {!signedIn && (
            <>
              <Button className="w-full" onClick={() => navigate(`/register${authQuery}`)}>
                Create account
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => navigate(`/login${authQuery}`)}>
                Sign in
              </Button>
            </>
          )}
          {rightAccount && (
            <Button className="w-full" onClick={handleAccept} disabled={busy}>
              {busy ? 'Joining...' : `Accept and join ${invite.workspaceName}`}
            </Button>
          )}
          {signedIn && !rightAccount && (
            <>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                This invite was sent to <span className="font-medium">{invite.email}</span>, but you're signed in as{' '}
                <span className="font-medium">{user.email}</span>. Sign in with that account to accept it.
              </p>
              <Button variant="secondary" className="w-full" onClick={switchAccount}>
                Sign in as {invite.email}
              </Button>
            </>
          )}
          <ErrorText>{error}</ErrorText>
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <Wordmark className="text-lg" />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 text-center">{body}</Card>
      </main>
    </div>
  );
}

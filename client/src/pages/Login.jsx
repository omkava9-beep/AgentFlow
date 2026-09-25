import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { login as loginApi, me } from '../api/auth';
import { apiErrorMessage } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore, defaultWorkspace, workspacePath } from '../store/workspaceStore';
import { Card, Button, TextField, ErrorText } from '../components/ui';
import { Wordmark } from '../components/Logo';
import AuthLayout from '../components/AuthLayout';

export default function Login() {
  const [params] = useSearchParams();
  // `?next=` returns the user to where they came from (an invite link, spec/23);
  // only same-app paths, so the param can't bounce anyone to another site.
  const rawNext = params.get('next') || '';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null;
  const [email, setEmail] = useState(params.get('email') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, user } = await loginApi(email, password);
      login(token, user);
      // Login doesn't return memberships; /me does (spec/22).
      const profile = await me();
      useWorkspaceStore.getState().setWorkspaces(profile.workspaces || []);
      const target = defaultWorkspace(profile.workspaces || []);
      navigate(next || (target ? workspacePath(target.slug, '/dashboard') : '/'));
    } catch (err) {
      setError(apiErrorMessage(err, 'Login failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm p-8">
        <Wordmark className="mb-6 justify-center text-lg lg:hidden" />
        <h1 className="mb-1 text-xl font-semibold text-slate-900 dark:text-slate-100">Welcome back</h1>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">Log in to your workflows</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Logging in...' : 'Log in'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
          No account?{' '}
          <Link to={`/register${params.toString() ? `?${params}` : ''}`} className="font-medium text-brand-600 dark:text-brand-400">
            Register
          </Link>
        </p>
      </Card>
    </AuthLayout>
  );
}

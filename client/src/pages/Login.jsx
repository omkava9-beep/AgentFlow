import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { login as loginApi, me } from '../api/auth';
import { apiErrorMessage } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore, defaultWorkspace, workspacePath } from '../store/workspaceStore';
import { Button, TextField, ErrorText } from '../components/ui';
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Welcome back</h1>
        <p className="mb-8 mt-1.5 text-sm text-muted">Log in to your workspace to continue.</p>
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
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            {loading ? 'Logging in…' : 'Log in'}
          </Button>
        </form>
        <p className="mt-6 text-sm text-muted">
          No account?{' '}
          <Link to={`/register${params.toString() ? `?${params}` : ''}`} className="font-medium text-accent hover:underline">
            Register
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}

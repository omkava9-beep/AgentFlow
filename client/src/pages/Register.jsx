import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register as registerApi } from '../api/auth';
import { apiErrorMessage } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { Card, Button, TextField, ErrorText } from '../components/ui';
import { Wordmark } from '../components/Logo';
import AuthLayout from '../components/AuthLayout';

export default function Register() {
  const [email, setEmail] = useState('');
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
      const { token, user } = await registerApi(email, password);
      login(token, user);
      navigate('/dashboard');
    } catch (err) {
      setError(apiErrorMessage(err, 'Registration failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm p-8">
        <Wordmark className="mb-6 justify-center text-lg lg:hidden" />
        <h1 className="mb-1 text-xl font-semibold text-slate-900 dark:text-slate-100">Create your account</h1>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">Start building agent workflows</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <TextField
            label="Password"
            type="password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating account...' : 'Register'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 dark:text-brand-400">
            Log in
          </Link>
        </p>
      </Card>
    </AuthLayout>
  );
}

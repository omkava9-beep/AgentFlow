import { Navigate, useLocation } from 'react-router-dom';
import { useEnsureWorkspaces } from '../hooks/useEnsureWorkspaces';
import { defaultWorkspace, workspacePath } from '../store/workspaceStore';
import { Skeleton } from './ui/Skeleton';

/**
 * Pre-workspace URLs (`/dashboard`, `/workflows/:id`, ...) keep working: they
 * land on the same page under the last-used or personal workspace. With `to`,
 * redirects to that page instead of the current path (used for `/` and `*`).
 */
export default function LegacyRedirect({ to }) {
  const { pathname, search } = useLocation();
  const { loaded, workspaces, error } = useEnsureWorkspaces();

  if (error) return <p className="p-6 text-sm text-red-500">{error}</p>;
  if (!loaded) return <div role="status" aria-label="Loading" className="p-6"><Skeleton className="h-6 w-40" /></div>;

  const target = defaultWorkspace(workspaces);
  if (!target) return <p className="p-6 text-sm text-slate-500 dark:text-slate-400">You don't belong to any workspace.</p>;
  return <Navigate to={`${workspacePath(target.slug, to || pathname)}${to ? '' : search}`} replace />;
}

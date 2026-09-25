import { Link } from 'react-router-dom';
import { useWorkspaceStore, workspacePath, defaultWorkspace } from '../store/workspaceStore';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * A real 404 (spec/36 §6) instead of the old silent redirect to the dashboard,
 * which hid broken links rather than surfacing them.
 */
export default function NotFound() {
  const slug = useWorkspaceStore((s) => s.current?.slug || defaultWorkspace(s.workspaces)?.slug);
  useDocumentTitle('Page not found');
  return (
    <div data-testid="not-found" className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <p className="text-5xl font-bold text-slate-300 dark:text-slate-700">404</p>
      <h1 className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">This page doesn&apos;t exist</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        The link may be mistyped, or the page may have moved.
      </p>
      <Link
        to={slug ? workspacePath(slug, '/dashboard') : '/'}
        className="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Go to the dashboard
      </Link>
    </div>
  );
}

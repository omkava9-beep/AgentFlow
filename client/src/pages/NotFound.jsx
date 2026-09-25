import { Link } from 'react-router-dom';
import { Compass, LayoutDashboard } from 'lucide-react';
import { useWorkspaceStore, workspacePath, defaultWorkspace } from '../store/workspaceStore';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Button } from '../components/ui/index';

/**
 * A real 404 (spec/36 §6) instead of the old silent redirect to the dashboard,
 * which hid broken links rather than surfacing them.
 */
export default function NotFound() {
  const slug = useWorkspaceStore((s) => s.current?.slug || defaultWorkspace(s.workspaces)?.slug);
  useDocumentTitle('Page not found');
  return (
    <div data-testid="not-found" className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-card border border-default bg-surface text-subtle shadow-sm">
        <Compass className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="mt-5 font-mono text-xs font-medium uppercase tracking-widest text-subtle">Error 404</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight text-fg">This page doesn&apos;t exist</h1>
      <p className="mt-1.5 text-sm text-muted">The link may be mistyped, or the page may have moved.</p>
      <Link to={slug ? workspacePath(slug, '/dashboard') : '/'} className="mt-6">
        <Button icon={LayoutDashboard} tabIndex={-1}>Go to the dashboard</Button>
      </Link>
    </div>
  );
}

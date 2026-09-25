import { Fragment, useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { getWorkspaceBySlug } from '../api/workspaces';
import { isNotFound } from '../api/client';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useEnsureWorkspaces } from '../hooks/useEnsureWorkspaces';
import { Card } from './ui';
import WorkspaceList from './WorkspaceList';
import { useWorkspaceChannel } from '../realtime/useWorkspaceChannel';
import { Skeleton, SkeletonGrid } from './ui/Skeleton';

/**
 * Resolves `/w/:slug` to a workspace the caller belongs to and makes it
 * `current` before any child page renders - children fire tenant-scoped
 * requests on mount, and those need the right `X-Workspace-Id` from the start.
 */
export default function WorkspaceRoute() {
  const { slug } = useParams();
  const { workspaces } = useEnsureWorkspaces();
  const current = useWorkspaceStore((s) => s.current);
  const [status, setStatus] = useState('loading');
  useWorkspaceChannel();

  useEffect(() => {
    let cancelled = false;
    const store = useWorkspaceStore.getState();
    const cached = store.workspaces.find((w) => w.slug === slug);
    if (cached) {
      store.setCurrent(cached);
      setStatus('ready');
      return undefined;
    }
    setStatus('loading');
    getWorkspaceBySlug(slug)
      .then((ws) => {
        if (cancelled) return;
        store.upsertWorkspace(ws);
        store.setCurrent(ws);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        // Never leave a previous workspace selected under a URL naming another.
        store.setCurrent(null);
        setStatus(isNotFound(err) ? 'notfound' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (status === 'notfound' || status === 'error') {
    return (
      <div className="mx-auto max-w-md py-10">
        <Card className="p-6">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {status === 'notfound' ? 'Workspace not found' : 'Could not load this workspace'}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {status === 'notfound'
              ? "It doesn't exist, or you're not a member of it."
              : 'Something went wrong. Try again, or pick another workspace.'}
          </p>
          {workspaces.length > 0 && (
            <>
              <h2 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Your workspaces</h2>
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                <WorkspaceList workspaces={workspaces} />
              </div>
            </>
          )}
        </Card>
      </div>
    );
  }

  if (status !== 'ready' || !current || current.slug !== slug) {
    return (
      <div role="status" aria-label="Loading workspace" className="space-y-4">
        <Skeleton className="h-7 w-48" />
        <SkeletonGrid count={3} />
      </div>
    );
  }

  // Keyed by workspace so switching remounts every page: resource ids and
  // loaded data don't carry over between workspaces.
  return (
    <Fragment key={current.id}>
      <Outlet />
    </Fragment>
  );
}

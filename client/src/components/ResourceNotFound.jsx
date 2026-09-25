import { Link } from 'react-router-dom';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { Card } from './ui';

/**
 * A resource id that exists but belongs to another workspace looks exactly like
 * a missing one (spec/22) - say which workspace we looked in, so a stale tab
 * after switching makes sense.
 */
export default function ResourceNotFound({ kind = 'workflow' }) {
  const current = useWorkspaceStore((s) => s.current);
  const wp = useWorkspacePath();
  return (
    <div className="mx-auto max-w-md py-10">
      <Card className="p-6 text-center">
        <h1 className="text-lg font-semibold text-fg">
          This {kind} isn't in {current?.name || 'this workspace'}
        </h1>
        <p className="mt-1 text-sm text-muted">
          It may have been deleted, or it belongs to a different workspace.
        </p>
        <Link to={wp('/dashboard')} className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          Back to dashboard
        </Link>
      </Card>
    </div>
  );
}

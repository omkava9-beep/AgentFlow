import { Link } from 'react-router-dom';
import { workspacePath } from '../store/workspaceStore';
import RoleBadge from './RoleBadge';

/** Plain list of the caller's workspaces, each linking to its dashboard. */
export default function WorkspaceList({ workspaces }) {
  return (
    <ul className="divide-y divide-default">
      {workspaces.map((w) => (
        <li key={w.id}>
          <Link
            to={workspacePath(w.slug, '/dashboard')}
            className="flex items-center justify-between px-3 py-2 text-sm text-fg hover:bg-bg-subtle"
          >
            <span className="truncate">{w.name}</span>
            <RoleBadge role={w.role} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

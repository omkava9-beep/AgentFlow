import { Navigate, useParams } from 'react-router-dom';
import { workspacePath } from '../store/workspaceStore';

/** Unknown path inside a workspace → that workspace's dashboard. */
export default function WorkspaceFallback() {
  const { slug } = useParams();
  return <Navigate to={workspacePath(slug, '/dashboard')} replace />;
}

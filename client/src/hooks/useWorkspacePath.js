import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useWorkspaceStore, workspacePath } from '../store/workspaceStore';

/** `wp('/workflows/123')` → `/w/<current slug>/workflows/123`. */
export function useWorkspacePath() {
  const { slug: routeSlug } = useParams();
  const currentSlug = useWorkspaceStore((s) => s.current?.slug);
  const slug = routeSlug || currentSlug;
  return useCallback((path) => workspacePath(slug, path), [slug]);
}

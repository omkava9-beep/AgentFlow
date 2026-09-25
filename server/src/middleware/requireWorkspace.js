import Membership from '../models/Membership.js';
import Workspace from '../models/Workspace.js';
import { HttpError } from './errorHandler.js';
import { isValidObjectId } from '../tenancy/scoped.js';
import { can } from '../tenancy/permissions.js';

/**
 * Resolves which tenant a request is acting in (spec/22 §3). Runs after
 * requireAuth. The workspace comes from `X-Workspace-Id`, or from the path on
 * `/api/workspaces/:workspaceId/**` routes.
 *
 * Membership is re-read on every request - no caching - so a role change or a
 * removal takes effect on the very next call.
 */
export async function requireWorkspace(req, res, next) {
  try {
    const header = req.get('X-Workspace-Id');
    const fromPath = req.params?.workspaceId;
    if (fromPath && header && header !== fromPath) {
      throw new HttpError(400, 'X-Workspace-Id does not match the workspace in the path');
    }
    const workspaceId = fromPath || header;
    if (!workspaceId) throw new HttpError(400, 'X-Workspace-Id header is required');

    // Malformed, unknown and not-a-member all look the same on purpose: the
    // response must not confirm that someone else's workspace exists.
    const notFound = new HttpError(404, 'Workspace not found');
    if (!isValidObjectId(workspaceId)) throw notFound;

    const membership = await Membership.findOne({ workspaceId, userId: req.userId });
    if (!membership) throw notFound;
    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) throw notFound;

    req.workspaceId = workspaceId;
    req.role = membership.role;
    req.membership = membership;
    req.workspace = workspace;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * 403, not 404: the caller is a member and already knows the resource exists,
 * so there's nothing to hide - they just can't do this to it.
 */
export function requirePermission(action) {
  return (req, res, next) => {
    if (!can(req.role, action)) {
      return next(new HttpError(403, "You don't have permission to do that"));
    }
    next();
  };
}

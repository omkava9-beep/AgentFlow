import Workspace from '../models/Workspace.js';
import Membership from '../models/Membership.js';
import Workflow from '../models/Workflow.js';
import { HttpError } from '../middleware/errorHandler.js';
import { scopedFilter } from '../tenancy/scoped.js';
import { deleteWorkspace } from '../tenancy/deleteWorkspace.js';
import { audit } from '../services/audit.js';
import {
  createWorkspace, listWorkspacesForUser, presentWorkspace, slugProblem,
} from '../services/workspaceService.js';

export async function list(req, res, next) {
  try {
    res.json(await listWorkspacesForUser(req.userId));
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) throw new HttpError(400, 'A workspace name is required');
    const { workspace, membership } = await createWorkspace({ name, userId: req.userId });
    await audit(req, 'workspace.created', { type: 'workspace', id: workspace._id, name: workspace.name },
      { workspaceId: workspace._id });
    res.status(201).json(presentWorkspace(workspace, membership));
  } catch (err) {
    next(err);
  }
}

/** How the client resolves `/w/:slug/...`. A non-member gets the same 404 as a missing slug. */
export async function getBySlug(req, res, next) {
  try {
    const workspace = await Workspace.findOne({ slug: String(req.params.slug).toLowerCase() });
    const membership = workspace && await Membership.findOne({ workspaceId: workspace._id, userId: req.userId });
    if (!membership) throw new HttpError(404, 'Workspace not found');
    res.json(presentWorkspace(workspace, membership));
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const workspace = req.workspace;
    const { name, slug, settings } = req.body || {};
    // Only fields that actually change go into the audit entry (spec/34 §2).
    const before = {};
    const after = {};
    let clearedShareLinks = null;

    if (name !== undefined) {
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (!trimmed) throw new HttpError(400, 'A workspace name is required');
      if (trimmed !== workspace.name) { before.name = workspace.name; after.name = trimmed; }
      workspace.name = trimmed;
    }

    if (slug !== undefined && slug !== workspace.slug) {
      const problem = slugProblem(slug);
      if (problem) throw new HttpError(400, problem);
      if (await Workspace.exists({ slug, _id: { $ne: workspace._id } })) {
        throw new HttpError(409, 'That slug is already taken');
      }
      before.slug = workspace.slug;
      after.slug = slug;
      workspace.slug = slug;
    }

    if (settings?.publicSharing !== undefined) {
      const enabled = Boolean(settings.publicSharing);
      // Turning sharing off is a kill switch (spec/23 §5): every existing link
      // dies, and turning it back on does not quietly republish them.
      const wasEnabled = workspace.settings?.publicSharing !== false;
      if (!enabled && wasEnabled) {
        const result = await Workflow.updateMany(scopedFilter(req, { shareToken: { $ne: null } }), { $set: { shareToken: null } });
        clearedShareLinks = result.modifiedCount;
      } else if (enabled !== wasEnabled) {
        before.settings = { publicSharing: wasEnabled };
        after.settings = { publicSharing: enabled };
      }
      workspace.settings = { ...(workspace.settings?.toObject?.() ?? workspace.settings ?? {}), publicSharing: enabled };
    }

    try {
      await workspace.save();
    } catch (err) {
      // The exists() check above can lose a race; the unique index can't.
      if (err?.code === 11000) throw new HttpError(409, 'That slug is already taken');
      throw err;
    }
    const target = { type: 'workspace', id: workspace._id, name: workspace.name };
    // The kill switch is one bulk event, not one per revoked link.
    if (clearedShareLinks !== null) {
      await audit(req, 'share.disabled_workspace', target, { meta: { count: clearedShareLinks } });
    }
    if (Object.keys(after).length) await audit(req, 'workspace.updated', target, { before, after });
    res.json(presentWorkspace(workspace, req.membership));
  } catch (err) {
    next(err);
  }
}

export async function remove(req, res, next) {
  try {
    const workspace = req.workspace;
    if (workspace.personal) throw new HttpError(400, "A personal workspace can't be deleted");
    if (req.body?.confirmName !== workspace.name) {
      throw new HttpError(400, 'Type the workspace name exactly to confirm deletion');
    }
    await deleteWorkspace(workspace._id);
    // The workspace's audit log is purged with it (spec/34 §4), so the deletion
    // itself leaves its trace on the console instead.
    console.log(`[audit] workspace.deleted "${workspace.name}" (${workspace._id}) by user ${req.userId} at ${new Date().toISOString()}`);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

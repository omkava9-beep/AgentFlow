import mongoose from 'mongoose';
import Workflow from '../models/Workflow.js';
import Run from '../models/Run.js';
import Template from '../models/Template.js';
import Connection from '../models/Connection.js';
import Membership from '../models/Membership.js';
import User from '../models/User.js';
import { scopedFilter } from '../tenancy/scoped.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `GET /api/search?q=` for the ⌘K palette's "Jump to" group (spec/36 §1).
 * Names and ids only - never node configs or run outputs. Everything is
 * scoped to the caller's current workspace; built-in templates are the one
 * cross-tenant thing it returns, and they belong to nobody.
 */
export async function search(req, res, next) {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const empty = { workspaceId: req.workspaceId, q, workflows: [], runs: [], connections: [], members: [], templates: [] };
    if (!q) return res.json(empty);

    const re = new RegExp(escapeRegex(q), 'i');
    const wsId = new mongoose.Types.ObjectId(req.workspaceId);

    const workflows = await Workflow.find(scopedFilter(req, { name: re }))
      .select('name updatedAt').sort({ updatedAt: -1 }).limit(8).lean();

    // Runs match either an id prefix (what people paste from a URL) or the
    // name of the workflow they belong to.
    const idPrefix = /^[0-9a-f]{3,24}$/i.test(q) ? q.toLowerCase() : null;
    const namedWorkflowIds = (await Workflow.find(scopedFilter(req, { name: re })).select('_id').limit(50).lean()).map((w) => w._id);
    const runMatch = scopedFilter(req, { workspaceId: wsId });
    const runs = await Run.aggregate([
      { $match: runMatch },
      { $sort: { createdAt: -1 } },
      { $limit: 2000 },
      { $addFields: { idStr: { $toString: '$_id' } } },
      {
        $match: {
          $or: [
            ...(idPrefix ? [{ idStr: { $regex: `^${idPrefix}` } }] : []),
            { workflowId: { $in: namedWorkflowIds } },
          ],
        },
      },
      { $limit: 5 },
      { $project: { workflowId: 1, status: 1, trigger: 1, createdAt: 1 } },
    ]);
    const runWorkflowNames = new Map(
      (await Workflow.find(scopedFilter(req, { _id: { $in: runs.map((r) => r.workflowId) } })).select('name').lean())
        .map((w) => [String(w._id), w.name]),
    );

    const connections = await Connection.find(scopedFilter(req, { name: re }))
      .select('name integration mode').limit(5).lean();

    const templates = await Template.find(scopedFilter(req, { workspaceId: { $in: [null, req.workspaceId] }, name: re }))
      .select('name workspaceId').limit(5).lean();

    const memberships = await Membership.find(scopedFilter(req)).select('userId role').lean();
    const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) }, $or: [{ name: re }, { email: re }] })
      .select('name email').limit(5).lean();
    const roleOf = new Map(memberships.map((m) => [String(m.userId), m.role]));

    res.json({
      ...empty,
      workflows: workflows.map((w) => ({ id: String(w._id), name: w.name })),
      runs: runs.map((r) => ({
        id: String(r._id),
        workflowId: String(r.workflowId),
        workflowName: runWorkflowNames.get(String(r.workflowId)) || 'Workflow',
        status: r.status,
        trigger: r.trigger,
        createdAt: r.createdAt,
      })),
      connections: connections.map((c) => ({ id: String(c._id), name: c.name, integration: c.integration, mode: c.mode })),
      templates: templates.map((t) => ({ id: String(t._id), name: t.name, builtIn: !t.workspaceId })),
      members: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email, role: roleOf.get(String(u._id)) })),
    });
  } catch (err) {
    next(err);
  }
}

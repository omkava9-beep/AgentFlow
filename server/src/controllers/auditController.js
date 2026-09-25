import mongoose from 'mongoose';
import AuditEvent from '../models/AuditEvent.js';
import Membership from '../models/Membership.js';
import Workflow from '../models/Workflow.js';
import { HttpError } from '../middleware/errorHandler.js';
import { scopedFilter, isValidObjectId } from '../tenancy/scoped.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const EXPORT_CAP = 10_000;

// Keyset pagination on (createdAt, _id), newest first (spec/34 §5). Offset
// paging would skip or repeat rows while new events are being written.
const encodeCursor = (event) => Buffer.from(`${event.createdAt.toISOString()}|${event._id}`).toString('base64url');

function decodeCursor(raw) {
  const [iso, id] = Buffer.from(String(raw), 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso);
  if (!iso || Number.isNaN(createdAt.getTime()) || !isValidObjectId(id)) throw new HttpError(400, 'Invalid cursor');
  return { createdAt, _id: new mongoose.Types.ObjectId(id) };
}

function parseDate(value, name) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `Invalid ${name} date`);
  return date;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The filter half, shared by the list and the CSV export so they can't drift. */
function buildFilter(req) {
  const { action, actorId, actorType, targetType, from, to } = req.query;
  const and = [scopedFilter(req)];

  if (action) {
    // `member.*` means the whole category; anything else is an exact action.
    const prefix = String(action).endsWith('.*') ? String(action).slice(0, -2) : null;
    and.push({ action: prefix ? { $regex: `^${escapeRegex(prefix)}\\.` } : String(action) });
  }
  if (actorType) and.push({ actorType: String(actorType) });
  if (actorId) {
    if (!isValidObjectId(actorId)) throw new HttpError(400, 'Invalid actorId');
    and.push({ actorId: new mongoose.Types.ObjectId(actorId) });
  }
  if (targetType) and.push({ targetType: String(targetType) });
  if (from || to) {
    const range = {};
    if (from) range.$gte = parseDate(from, 'from');
    if (to) range.$lte = parseDate(to, 'to');
    and.push({ createdAt: range });
  }
  return and;
}

function present(event, { memberIds, liveWorkflowIds }) {
  return {
    id: event._id.toString(),
    createdAt: event.createdAt,
    actorType: event.actorType,
    actorId: event.actorId ? event.actorId.toString() : null,
    actorLabel: event.actorLabel,
    // The UI appends "(no longer a member)" rather than dropping the label.
    actorIsMember: event.actorType === 'user' ? memberIds.has(String(event.actorId)) : null,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId ? event.targetId.toString() : null,
    targetLabel: event.targetLabel,
    // Only workflows have a page to deep-link to; hide the link once it's gone.
    targetExists: event.targetType === 'workflow' ? liveWorkflowIds.has(String(event.targetId)) : null,
    summary: event.summary,
    before: event.before,
    after: event.after,
    meta: event.meta,
    ip: event.ip,
  };
}

async function presentPage(req, events) {
  const userIds = [...new Set(events.filter((e) => e.actorType === 'user' && e.actorId).map((e) => String(e.actorId)))];
  const workflowIds = [...new Set(events.filter((e) => e.targetType === 'workflow' && e.targetId).map((e) => String(e.targetId)))];
  const [members, workflows] = await Promise.all([
    Membership.find({ workspaceId: req.workspaceId, userId: { $in: userIds } }).select('userId').lean(),
    Workflow.find(scopedFilter(req, { _id: { $in: workflowIds } })).select('_id').lean(),
  ]);
  const ctx = {
    memberIds: new Set(members.map((m) => String(m.userId))),
    liveWorkflowIds: new Set(workflows.map((w) => String(w._id))),
  };
  return events.map((e) => present(e, ctx));
}

export async function listAudit(req, res, next) {
  try {
    const and = buildFilter(req);
    if (req.query.before) {
      const c = decodeCursor(req.query.before);
      and.push({ $or: [{ createdAt: { $lt: c.createdAt } }, { createdAt: c.createdAt, _id: { $lt: c._id } }] });
    }
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const events = await AuditEvent.find({ $and: and }).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
    const page = events.slice(0, limit);
    res.json({
      items: await presentPage(req, page),
      nextCursor: events.length > limit ? encodeCursor(page[page.length - 1]) : null,
    });
  } catch (err) {
    next(err);
  }
}

const csvCell = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportAudit(req, res, next) {
  try {
    const events = await AuditEvent.find({ $and: buildFilter(req) })
      .sort({ createdAt: -1, _id: -1 })
      .limit(EXPORT_CAP + 1)
      .lean();

    const header = ['time', 'actor_type', 'actor', 'action', 'target_type', 'target', 'summary', 'ip'];
    const lines = [header.join(',')];
    for (const e of events.slice(0, EXPORT_CAP)) {
      lines.push([
        e.createdAt.toISOString(), e.actorType, e.actorLabel, e.action, e.targetType, e.targetLabel, e.summary, e.ip,
      ].map(csvCell).join(','));
    }
    if (events.length > EXPORT_CAP) lines.push('# truncated — narrow the date range');

    const stamp = new Date().toISOString().slice(0, 10);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="audit-${req.workspace.slug}-${stamp}.csv"`);
    res.send(`${lines.join('\n')}\n`);
  } catch (err) {
    next(err);
  }
}

import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Run from '../models/Run.js';
import User from '../models/User.js';
import Workflow from '../models/Workflow.js';
import Workspace from '../models/Workspace.js';
import Membership from '../models/Membership.js';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/errorHandler.js';
import { sendMail } from './outbox.js';
import { audit } from './audit.js';
import { resumeRun } from './resumeService.js';
import { getIo } from '../sockets/ioInstance.js';
import { notify } from './notify.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const LINK_TTL_MS = 7 * DAY_MS;

const idStr = (v) => (v == null ? null : String(v));

// ---------------------------------------------------------------- assignees

/**
 * spec/32 §2: the assignee spec becomes a snapshot of concrete user ids at wait
 * time - listed users who are still members, plus members holding any listed
 * role. Nobody at all → the workspace's owners and admins. A later role change
 * doesn't silently add or remove approvers mid-wait.
 */
export async function prepareApproval({ workspaceId, config, title, description, input }) {
  const logs = [];
  const members = await Membership.find({ workspaceId }).select('userId role').lean();
  const memberIds = new Set(members.map((m) => String(m.userId)));
  const wantedUsers = (config.assignees?.userIds || []).map(String);
  const wantedRoles = new Set(config.assignees?.roles || []);

  const ids = new Set();
  for (const id of wantedUsers) {
    if (memberIds.has(id)) ids.add(id);
    else logs.push(`[approval] assignee ${id} is not a member of this workspace - ignored`);
  }
  for (const m of members) if (wantedRoles.has(m.role)) ids.add(String(m.userId));
  if (!ids.size) {
    for (const m of members) if (m.role === 'owner' || m.role === 'admin') ids.add(String(m.userId));
    logs.push('[approval] no assignees configured - owners and admins can decide');
  }

  const users = await User.find({ _id: { $in: [...ids] } }).select('name email').lean();
  const assignees = users.map((u) => ({ id: String(u._id), name: u.name || u.email, email: u.email }));

  let minApprovals = Math.max(1, Math.floor(Number(config.minApprovals) || 1));
  if (assignees.length && minApprovals > assignees.length) {
    logs.push(`[approval] minApprovals ${minApprovals} is more than the ${assignees.length} assignee(s) - clamped`);
    minApprovals = assignees.length;
  }

  const afterMs = Number(config.timeout?.afterMs);
  const resumeAt = config.timeout && Number.isFinite(afterMs) && afterMs > 0 ? new Date(Date.now() + afterMs) : null;
  const timeoutOutcome = config.timeout?.outcome === 'approved' ? 'approved' : 'rejected';

  const snapshot = {
    title,
    description,
    input: config.showInput === false ? undefined : input,
    showInput: config.showInput !== false,
    assigneeIds: assignees.map((a) => a.id),
    assigneeNames: Object.fromEntries(assignees.map((a) => [a.id, a.name])),
    minApprovals,
    timeoutOutcome: resumeAt ? timeoutOutcome : null,
    approvals: [],
    decision: null,
    decidedBy: null,
    decidedByName: null,
    decidedAt: null,
    comment: '',
  };
  return { snapshot, assignees, assigneeIds: snapshot.assigneeIds, minApprovals, resumeAt, logs };
}

// ---------------------------------------------------------------- signed links

/**
 * spec/32 §8: HMAC-SHA256 with APPROVAL_LINK_SECRET, or a key derived from
 * JWT_SECRET with HKDF when that isn't set - so approvals work out of the box
 * without ever reusing the JWT key directly.
 */
function linkKey() {
  if (env.approvalLinkSecret) return Buffer.from(env.approvalLinkSecret);
  return Buffer.from(crypto.hkdfSync('sha256', env.jwtSecret, 'agentflow', 'approval-links', 32));
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signApprovalLink({ runId, nodeId, userId, exp }) {
  const payload = b64url(JSON.stringify({ r: String(runId), n: String(nodeId), u: String(userId), e: exp }));
  const sig = b64url(crypto.createHmac('sha256', linkKey()).update(payload).digest());
  return `${payload}.${sig}`;
}

/** → { runId, nodeId, userId, exp } or throws HttpError 404 (bad) / 410 (expired). */
export function verifyApprovalLink(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) throw new HttpError(404, 'This approval link is not valid');
  const expected = crypto.createHmac('sha256', linkKey()).update(payload).digest();
  let given;
  try { given = Buffer.from(sig, 'base64url'); } catch { given = Buffer.alloc(0); }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new HttpError(404, 'This approval link is not valid');
  }
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new HttpError(404, 'This approval link is not valid'); }
  if (!data?.r || !data?.n || !data?.u || !mongoose.isValidObjectId(data.r)) throw new HttpError(404, 'This approval link is not valid');
  if (data.e && Date.now() > data.e) throw new HttpError(410, 'This approval link has expired');
  return { runId: data.r, nodeId: data.n, userId: data.u, exp: data.e };
}

export function approvalLinkUrl(token) {
  return `${env.clientOrigin.replace(/\/+$/, '')}/approve/${token}`;
}

// ---------------------------------------------------------------- delivery

// notify() never throws and drops the actor and non-members (spec/29).
const notifyLazy = (userIds, payload) => notify(userIds, payload);

async function workspaceSlug(workspaceId) {
  const ws = await Workspace.findById(workspaceId).select('slug name').lean();
  return ws || { slug: '', name: '' };
}

/**
 * Sends the request to every assignee (spec/32 §8): an in-app notification,
 * and an Outbox message carrying their own signed link.
 */
export async function deliverApprovalRequest({ runId, nodeId, workspaceId, workflowName, approval }) {
  const ws = await workspaceSlug(workspaceId);
  const users = await User.find({ _id: { $in: approval.assigneeIds } }).select('email name').lean();
  // The link lives as long as the approval can: its timeout, or 7 days.
  const exp = Date.now() + LINK_TTL_MS;
  for (const user of users) {
    const token = signApprovalLink({ runId, nodeId, userId: user._id, exp });
    await sendMail({
      to: user.email,
      subject: `Approval needed: ${approval.title}`,
      text: `${workflowName ? `${workflowName} is waiting for your decision.\n\n` : ''}${approval.title}\n${approval.description ? `\n${approval.description}\n` : ''}\nApprove or reject: ${approvalLinkUrl(token)}`,
      kind: 'notification',
      workspaceId,
      meta: { runId: String(runId), nodeId, link: approvalLinkUrl(token), approval: true },
    });
  }
  await notifyLazy(approval.assigneeIds, {
    workspaceId,
    kind: 'approval_requested',
    title: `Approval needed: ${approval.title}`,
    body: workflowName ? `${workflowName} is waiting for your decision.` : '',
    link: `/w/${ws.slug}/runs/${runId}`,
    groupKey: `approval_requested:${runId}:${nodeId}`,
  });
}

// ---------------------------------------------------------------- decisions

function emitNode(runId, patch) {
  try {
    getIo().to(`run:${runId}`).emit('node:update', { runId: String(runId), ...patch });
  } catch {
    // no socket layer in scripts
  }
}

function waitingApproval(run, nodeId) {
  return (run.nodeResults || []).find((r) => r.nodeId === nodeId && r.approval);
}

function decidedSummary(result) {
  const a = result?.approval || {};
  return {
    decision: a.decision || null,
    decidedBy: a.decidedBy === 'timeout' ? 'timeout' : a.decidedByName ? { id: idStr(a.decidedBy), name: a.decidedByName } : null,
    decidedAt: a.decidedAt || null,
  };
}

/**
 * Records one person's decision (spec/32 §2). The first reject decides; an
 * approve decides once `minApprovals` distinct approvals exist. The final
 * decision goes through resumeRun, whose conditional claim is the lock: of two
 * concurrent final decisions exactly one wins and the other gets 409.
 *
 * `override` is `runs:approve_any` - deciding without being assigned.
 */
export async function decide({ runId, nodeId, userId, decision, comment = '', via = 'app', override = false, req = null }) {
  const run = await Run.findById(runId).lean();
  if (!run) throw new HttpError(404, 'Run not found');
  const result = waitingApproval(run, nodeId);
  if (!result) throw new HttpError(404, 'Approval not found');

  if (result.status !== 'waiting') {
    const err = new HttpError(409, 'Already decided');
    err.details = decidedSummary(result);
    throw err;
  }

  // Still a member right now - removal revokes pending approvals and links.
  const membership = await Membership.findOne({ workspaceId: run.workspaceId, userId }).lean();
  if (!membership) throw new HttpError(404, 'Approval not found');
  const assigned = (result.approval.assigneeIds || []).map(String).includes(String(userId));
  if (!assigned && !override) throw new HttpError(403, 'You are not an approver for this step');

  const user = await User.findById(userId).select('name email').lean();
  const actor = { id: String(userId), name: user?.name || user?.email || 'someone' };
  const verdict = decision === 'approve' || decision === 'approved' ? 'approved' : 'rejected';
  const entry = { userId: String(userId), name: actor.name, decision: verdict, comment: String(comment || '').slice(0, 2000), at: new Date(), via };

  const existing = result.approval.approvals || [];
  if (existing.some((a) => a.userId === entry.userId && a.decision === 'approved') && verdict === 'approved') {
    throw new HttpError(409, 'You already approved this');
  }
  const approvedCount = new Set(existing.filter((a) => a.decision === 'approved').map((a) => a.userId)).size;
  const isFinal = verdict === 'rejected' || approvedCount + 1 >= (result.approval.minApprovals || 1);

  let outcome;
  if (isFinal) {
    const claimed = await resumeRun(runId, {
      nodeId,
      approvalEntry: entry,
      resolution: {
        decision: verdict,
        decidedBy: actor,
        comment: entry.comment,
        decidedAt: entry.at,
        approvals: [...existing, entry],
      },
    });
    if (!claimed.ok) {
      const fresh = await Run.findById(runId).lean();
      const err = new HttpError(409, 'Already decided');
      err.details = decidedSummary(waitingApproval(fresh, nodeId));
      throw err;
    }
    outcome = { decision: verdict, status: 'decided' };
  } else {
    // Not final yet: record the approval, still conditional on the node waiting
    // and this person not having approved already.
    const pushed = await Run.updateOne(
      { _id: runId, nodeResults: { $elemMatch: { nodeId, status: 'waiting', 'approval.approvals.userId': { $ne: entry.userId } } } },
      { $push: { 'nodeResults.$.approval.approvals': entry } },
    );
    if (!pushed.modifiedCount) throw new HttpError(409, 'Already decided');
    emitNode(runId, { nodeId, 'approval.approvals': [...existing, entry] });
    outcome = { decision: verdict, status: 'waiting', approvals: approvedCount + 1, needed: result.approval.minApprovals };
  }

  const workflow = await Workflow.findById(run.workflowId).select('name').lean(); // tenancy: capability lookup (run already resolved and authorized)
  // The audit log's targets are workflows, not runs; the run id rides in meta.
  await audit(req || { userId, workspaceId: run.workspaceId }, 'approval.decided', {
    type: 'workflow', id: String(run.workflowId), name: workflow?.name || 'workflow',
  }, { workspaceId: run.workspaceId, meta: { runId: String(runId), nodeId, decision: verdict, via, final: isFinal } });

  if (isFinal) {
    const ws = await workspaceSlug(run.workspaceId);
    const others = (result.approval.assigneeIds || []).map(String).filter((id) => id !== String(userId));
    const recipients = [...new Set([...others, ...(run.triggeredBy ? [String(run.triggeredBy)] : [])])];
    await notifyLazy(recipients, {
      workspaceId: run.workspaceId,
      kind: 'approval_resolved',
      title: `${verdict === 'approved' ? 'Approved' : 'Rejected'}: ${result.approval.title}`,
      body: `${actor.name} ${verdict} it${entry.comment ? `: "${entry.comment}"` : ''}.`,
      link: `/w/${ws.slug}/runs/${runId}`,
      actorId: userId,
    });
  }
  return outcome;
}

// ---------------------------------------------------------------- inbox

/** spec/32 API: approvals for the caller (or every one, with runs:approve_any and all=1). */
export async function listApprovals({ workspaceId, userId, status = 'pending', all = false }) {
  const uid = String(userId);
  const nodeMatch = status === 'decided'
    ? { 'approval.decision': { $ne: null } }
    : { status: 'waiting', approval: { $ne: null } };
  if (!all) nodeMatch['approval.assigneeIds'] = uid;
  const runs = await Run.find({ workspaceId, nodeResults: { $elemMatch: nodeMatch } })
    .sort({ updatedAt: -1 })
    .limit(200)
    .select('workflowId status nodeResults createdAt updatedAt trigger')
    .lean();
  const workflowIds = [...new Set(runs.map((r) => String(r.workflowId)))];
  const workflows = await Workflow.find({ _id: { $in: workflowIds }, workspaceId }).select('name').lean();
  const names = new Map(workflows.map((w) => [String(w._id), w.name]));

  const rows = [];
  for (const run of runs) {
    for (const r of run.nodeResults || []) {
      const a = r.approval;
      if (!a) continue;
      if (status === 'decided' ? !a.decision : r.status !== 'waiting') continue;
      if (!all && !(a.assigneeIds || []).map(String).includes(uid)) continue;
      rows.push({
        runId: String(run._id),
        nodeId: r.nodeId,
        workflowId: String(run.workflowId),
        workflowName: names.get(String(run.workflowId)) || 'Workflow',
        runStatus: run.status,
        title: a.title,
        description: a.description,
        input: a.showInput ? a.input : undefined,
        since: r.waitingSince,
        resumeAt: r.resumeAt,
        timeoutOutcome: a.timeoutOutcome,
        minApprovals: a.minApprovals,
        approvals: a.approvals || [],
        assignees: (a.assigneeIds || []).map((id) => ({ id: String(id), name: a.assigneeNames?.[id] || 'member' })),
        assignedToMe: (a.assigneeIds || []).map(String).includes(uid),
        ...decidedSummary(r),
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- link page

/** GET /api/approval-links/:token. Never decides (link unfurlers follow GETs). */
export async function describeLink(token) {
  const link = verifyApprovalLink(token);
  const run = await Run.findById(link.runId).lean();
  const result = run && waitingApproval(run, link.nodeId);
  if (!run || !result) throw new HttpError(404, 'This approval link is not valid');
  const member = await Membership.findOne({ workspaceId: run.workspaceId, userId: link.userId }).lean();
  const assigned = (result.approval.assigneeIds || []).map(String).includes(String(link.userId));
  if (!member || !assigned) throw new HttpError(404, 'This approval link is not valid');
  const [workspace, workflow, user] = await Promise.all([
    Workspace.findById(run.workspaceId).select('name slug').lean(),
    Workflow.findById(run.workflowId).select('name').lean(), // tenancy: capability lookup (signed link)
    User.findById(link.userId).select('name email').lean(),
  ]);
  const a = result.approval;
  return {
    workspaceName: workspace?.name || '',
    workflowName: workflow?.name || '',
    title: a.title,
    description: a.description,
    ...(a.showInput && { input: a.input }),
    status: result.status === 'waiting' ? 'pending' : a.decision || run.status,
    approver: { id: String(link.userId), name: user?.name || user?.email },
    minApprovals: a.minApprovals,
    approvals: a.approvals || [],
    resumeAt: result.resumeAt,
    ...decidedSummary(result),
  };
}

export async function decideViaLink(token, { decision, comment }) {
  const link = verifyApprovalLink(token);
  await describeLink(token); // same eligibility checks as the page
  return decide({ runId: link.runId, nodeId: link.nodeId, userId: link.userId, decision, comment, via: 'link' });
}

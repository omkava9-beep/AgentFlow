import Workflow from '../models/Workflow.js';
import WorkflowVersion from '../models/WorkflowVersion.js';
import Run from '../models/Run.js';
import Template from '../models/Template.js';
import SandboxRecord from '../models/SandboxRecord.js';
import Membership from '../models/Membership.js';
import Workspace from '../models/Workspace.js';
import Invitation from '../models/Invitation.js';
import ApiKey from '../models/ApiKey.js';
import OutboxMessage from '../models/OutboxMessage.js';
import UsageCounter from '../models/UsageCounter.js';
import { forgetPlan } from '../services/planCache.js';
import Connection from '../models/Connection.js';
import KnowledgeDoc from '../models/KnowledgeDoc.js';
import CommentThread from '../models/CommentThread.js';
import Comment from '../models/Comment.js';
import WorkflowWatch from '../models/WorkflowWatch.js';
import Notification from '../models/Notification.js';
import { purgeWorkspaceAudit } from '../models/AuditEvent.js';
import { requestCancel } from '../engine/executeRun.js';
import { unregisterSchedule } from '../scheduler/index.js';

/**
 * Every collection holding tenant documents, deleted when a workspace is
 * (spec/22 §7). One list, on purpose: each later spec that adds a tenant
 * collection (versions, connections, API keys, invitations, comments,
 * notifications, usage, audit...) appends its model here, and check:tenancy
 * fails if a model with a `workspaceId` path is missing.
 *
 * `filter` narrows the delete where a collection mixes tenant and global rows
 * (built-in templates have `workspaceId: null` and belong to everyone).
 */
export const TENANT_MODELS = [
  { model: Workflow },
  // Published snapshots (spec/30).
  { model: WorkflowVersion },
  { model: Run },
  { model: Template },
  { model: SandboxRecord },
  { model: Membership },
  { model: Invitation },
  { model: ApiKey },
  // Mail already "delivered" to someone's Outbox about this workspace goes too.
  { model: OutboxMessage },
  // Daily usage counters (spec/33).
  { model: UsageCounter },
  { model: Connection },
  // Comment threads, comments, watches and notifications (spec/29).
  { model: CommentThread },
  { model: Comment },
  { model: WorkflowWatch },
  { model: Notification },
  // Knowledge Base documents (spec/27 §7). RSS seen-items live in the sandbox
  // store (`rss.seen`), so SandboxRecord above already covers them.
  { model: KnowledgeDoc },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function deleteWorkspace(workspaceId) {
  // Stop the in-process pieces first, so no cron tick or in-flight node writes
  // into a workspace whose documents are being removed.
  const workflows = await Workflow.find({ workspaceId }).select('_id');
  for (const wf of workflows) unregisterSchedule(wf._id);

  const active = await Run.find({ workspaceId, status: { $in: ['pending', 'running'] } }).select('_id');
  for (const run of active) requestCancel(run._id.toString());
  // Cancellation is cooperative (spec/19): in-flight nodes drain first. Wait a
  // bounded time for that, then delete regardless - the engine tolerates its
  // Run document disappearing (updateOne simply matches nothing).
  for (let waited = 0; active.length && waited < 5000; waited += 200) {
    const still = await Run.countDocuments({ _id: { $in: active.map((r) => r._id) }, status: { $in: ['pending', 'running'] } });
    if (!still) break;
    await sleep(200);
  }

  for (const { model, filter = {} } of TENANT_MODELS) {
    await model.deleteMany({ workspaceId, ...filter });
  }
  // Last, and through its own path: the audit log is append-only everywhere
  // else (spec/34 §4). Nobody is a member any more, so nobody could read it.
  await purgeWorkspaceAudit(workspaceId);
  await Workspace.deleteOne({ _id: workspaceId });
  forgetPlan(workspaceId);
}

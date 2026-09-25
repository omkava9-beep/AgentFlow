import { resolveValue } from '../../integrations/template.js';
import { templateScope } from './shared.js';

/**
 * spec/32: pauses the run until a person decides. Orchestration kind - it never
 * takes a queue slot. `execute` puts the node into `waiting` (resolving the
 * assignee snapshot and sending the requests); `resolve` turns the decision
 * that woke it into an output and routes `approved` or `rejected`.
 *
 * A rejection is a routing outcome, not a failure: the node succeeds with
 * `decision: 'rejected'`, exactly like a condition's `false` branch.
 */
export default {
  type: 'approval',
  kind: 'orchestration',
  handles: { source: ['approved', 'rejected'], error: false },

  async execute(ctx) {
    // Lazy: the approval service pulls in models, outbox and notifications.
    const { prepareApproval, deliverApprovalRequest } = await import('../../services/approvalService.js');
    const scope = templateScope(ctx);
    const logs = [];
    const title = String(resolveValue(ctx.config.title || ctx.config.label || 'Approval needed', scope, logs) ?? '');
    const description = String(resolveValue(ctx.config.description || '', scope, logs) ?? '');
    const approval = await prepareApproval({
      workspaceId: ctx.workspaceId,
      config: ctx.config,
      title,
      description,
      input: ctx.input,
    });
    for (const line of approval.logs) logs.push(line);
    const names = approval.assignees.map((a) => a.name).join(', ') || 'nobody';
    logs.push(`[approval] waiting for ${approval.minApprovals} of ${approval.assigneeIds.length} (${names})`);
    return {
      logs,
      wait: {
        reason: 'approval',
        resumeAt: approval.resumeAt,
        patch: { approval: approval.snapshot },
        afterPersist: () => deliverApprovalRequest({
          runId: ctx.run.id,
          nodeId: ctx.node.id,
          workspaceId: ctx.workspaceId,
          workflowName: ctx.run.workflowName,
          approval: approval.snapshot,
        }),
      },
    };
  },

  /** `resolution` = { decision: 'approved' | 'rejected', decidedBy, comment, decidedAt, approvals } */
  resolve(ctx, resolution) {
    const decision = resolution.decision === 'approved' ? 'approved' : 'rejected';
    ctx.pruneOutgoing((edge) => edge.sourceHandle !== decision);
    const decidedAt = resolution.decidedAt || new Date();
    const output = {
      decision,
      decidedBy: resolution.decidedBy,
      comment: resolution.comment || '',
      decidedAt,
      approvals: resolution.approvals || [],
      input: ctx.input,
    };
    const who = resolution.decidedBy === 'timeout' ? 'timeout (default outcome)' : resolution.decidedBy?.name || 'someone';
    return {
      output,
      passThrough: output,
      logs: [`[approval] ${decision} by ${who}${resolution.comment ? `: "${resolution.comment}"` : ''}`],
      patch: {
        'approval.decision': decision,
        'approval.decidedBy': resolution.decidedBy === 'timeout' ? 'timeout' : resolution.decidedBy?.id ?? null,
        'approval.decidedByName': resolution.decidedBy === 'timeout' ? 'timeout' : resolution.decidedBy?.name ?? null,
        'approval.decidedAt': decidedAt,
        'approval.comment': resolution.comment || '',
      },
    };
  },
};

import mongoose from 'mongoose';

const nodeResultSchema = new mongoose.Schema({
  nodeId: String,
  status: { type: String, enum: ['pending', 'running', 'waiting', 'success', 'failed', 'skipped'], default: 'pending' },
  output: mongoose.Schema.Types.Mixed,
  logs: { type: [String], default: [] },
  cached: { type: Boolean, default: false },
  attempts: { type: Number, default: 1 },
  handoffTarget: { type: String, default: null },
  // Tool nodes (spec/26): what was called, and what actually ran - live or
  // sandbox - rather than what the config implied.
  integration: { type: String, default: null },
  action: { type: String, default: null },
  mode: { type: String, enum: ['live', 'sandbox', 'mock', 'llm', null], default: null },
  startedAt: Date,
  finishedAt: Date,
  durationMs: Number,
  // spec/33: time spent waiting for a queue slot, and why it's waiting now.
  waiting: { type: Boolean, default: false },
  waitReason: { type: String, default: null },
  queuedMs: Number,
  // spec/31: a failure routed down the node's error edge. Status stays 'failed',
  // but the run doesn't fail because of it.
  handled: { type: Boolean, default: false },
  // Loop / sub-workflow children, and a loop's live `done / total`.
  childRunIds: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
  progress: { type: { done: Number, total: Number }, default: null },
  // Long delays park the run until this time (spec/31 §3, spec/32).
  resumeAt: { type: Date, default: null },
  // spec/32: when the node started waiting (approval or parked delay), and the
  // approval's snapshot - assignees, decisions so far and the outcome.
  waitingSince: { type: Date, default: null },
  approval: { type: mongoose.Schema.Types.Mixed, default: null },
  // spec/37: an agent's tool calls, one entry per call (args and outputs
  // redacted), and how many tool-use steps it took.
  toolCalls: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  agentSteps: { type: Number, default: undefined },
  // spec/35: a retry-from-failed copies this result from the original run
  // instead of executing the node again.
  reused: { type: Boolean, default: false },
  // spec/35 §6: one entry per attempt, capped at 20. `backoffMs` is the wait
  // before the NEXT attempt.
  attemptsLog: {
    type: [{
      _id: false,
      attempt: Number,
      startedAt: Date,
      finishedAt: Date,
      durationMs: Number,
      outcome: { type: String, enum: ['success', 'failed'] },
      error: { type: String, default: null },
      backoffMs: { type: Number, default: null },
      cached: { type: Boolean, default: false },
      truncated: { type: Boolean, default: false },
    }],
    default: undefined,
  },
}, { _id: false });

const runSchema = new mongoose.Schema({
  workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true, index: true },
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  // The user who pressed Run; null for schedule, webhook and event runs.
  triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: ['pending', 'running', 'waiting', 'success', 'failed', 'cancelled'], default: 'pending' },
  cancelReason: { type: String, enum: ['user', 'timeout', null], default: null },
  // spec/32 §6: why a run failed. cancelReason keeps its phase-2 meaning.
  failReason: { type: String, enum: ['nodes_failed', 'timeout', 'interrupted', null], default: null },
  // Parked nodes (spec/32 §3); empty unless status is 'waiting'.
  waiting: {
    type: [{ _id: false, nodeId: String, reason: { type: String, enum: ['approval', 'delay'] }, since: Date, resumeAt: Date }],
    default: [],
  },
  // The engine's downstream-facing state, written with every node result so a
  // parked run can be rehydrated from MongoDB alone (spec/32 §3-4).
  engineState: {
    outputs: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    pruned: { type: [String], default: [] },
    activeMs: { type: Number, default: 0 },
  },
  trigger: { type: String, enum: ['manual', 'schedule', 'webhook', 'event', 'api', 'subworkflow'], default: 'manual' },
  // Lineage for sub-workflow and loop child runs (spec/31 §6). A top-level run
  // has depth 0 and no parent; `rootRunId` lets a cancel reach every descendant.
  parentRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'Run', default: null },
  parentNodeId: { type: String, default: null },
  rootRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'Run', default: null },
  depth: { type: Number, default: 0 },
  iteration: { type: Number, default: null },
  // The workspace API key that started an `api` run (spec/24), for the audit log.
  apiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: 'ApiKey', default: null },
  // spec/30: which graph this run executed. Published runs point at their
  // version; draft (test) runs carry a snapshot, so the monitor can always draw
  // the graph that actually ran, whatever the draft looks like now.
  isDraft: { type: Boolean, default: false },
  versionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowVersion', default: null },
  versionNumber: { type: Number, default: null },
  graph: { type: mongoose.Schema.Types.Mixed, default: null },
  // spec/35: lineage for a re-run (same input, same graph) and a
  // retry-from-failed (which nodes were retried).
  rerunOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Run', default: null },
  retryOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Run', default: null },
  retriedFromNodeIds: { type: [String], default: undefined },
  // Payload the trigger supplied, handed to the Start node as its output.
  input: { type: mongoose.Schema.Types.Mixed, default: null },
  startedAt: Date,
  finishedAt: Date,
  nodeResults: { type: [nodeResultSchema], default: [] },
}, { timestamps: true });

runSchema.index({ workspaceId: 1, createdAt: -1 });
// spec/35 §3: the Runs page's cursor order and its two common filters.
runSchema.index({ workspaceId: 1, createdAt: -1, _id: -1 });
runSchema.index({ workspaceId: 1, workflowId: 1, createdAt: -1 });
runSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });
runSchema.index({ rootRunId: 1 });
runSchema.index({ parentRunId: 1 });
runSchema.index({ status: 1, 'waiting.resumeAt': 1 });

export default mongoose.model('Run', runSchema);

import mongoose from 'mongoose';

const nodeSchema = new mongoose.Schema({
  id: String,
  // spec/31 adds the orchestration and data node types; `approval` arrives with spec/32.
  type: {
    type: String,
    enum: ['start', 'end', 'agent', 'tool', 'condition', 'transform', 'code', 'delay', 'loop', 'merge', 'subworkflow', 'approval'],
  },
  position: { x: Number, y: Number },
  data: mongoose.Schema.Types.Mixed,
}, { _id: false });

const edgeSchema = new mongoose.Schema({
  id: String,
  source: String,
  target: String,
  sourceHandle: String,
  label: String,
}, { _id: false });

const workflowSchema = new mongoose.Schema({
  // The tenant boundary (spec/22). Access is decided by membership of this
  // workspace, never by who created the workflow.
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  // Informational only - never used for access checks.
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  name: { type: String, required: true, default: 'Untitled workflow' },
  nodes: { type: [nodeSchema], default: [] },
  edges: { type: [edgeSchema], default: [] },
  schedule: {
    cronExpression: { type: String, default: null },
    enabled: { type: Boolean, default: false },
  },
  webhook: {
    token: { type: String, default: null },
    enabled: { type: Boolean, default: false },
  },
  eventTrigger: {
    eventName: { type: String, default: null },
    enabled: { type: Boolean, default: false },
    // spec/26 §7: listen to one connection's integration events only (e.g.
    // one of two Stripe accounts). null = any connection.
    connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Connection', default: null },
  },
  shareToken: { type: String, default: null },
  // spec/28: the last collaboration seq flushed, and who made the last edit.
  draftSeq: { type: Number, default: 0 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // spec/30: the published version triggers run, and whether the draft differs
  // from it. The counter hands out version numbers atomically.
  versionCounter: { type: Number, default: 0 },
  publishedVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowVersion', default: null },
  publishedVersion: { type: Number, default: null },
  publishedContentHash: { type: String, default: null },
  publishedAt: { type: Date, default: null },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  hasUnpublishedChanges: { type: Boolean, default: false },
}, { timestamps: true });

workflowSchema.index({ workspaceId: 1, updatedAt: -1 });
workflowSchema.index({ 'eventTrigger.eventName': 1, 'eventTrigger.enabled': 1 });
workflowSchema.index({ 'webhook.token': 1 });
workflowSchema.index({ shareToken: 1 });

export default mongoose.model('Workflow', workflowSchema);

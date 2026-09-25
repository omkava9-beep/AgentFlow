import mongoose from 'mongoose';

/**
 * An immutable, numbered snapshot of a workflow's graph (spec/30 §1). Triggers
 * run the published one; the canvas edits the draft. Never updated or deleted
 * except when its workflow is deleted.
 */
const workflowVersionSchema = new mongoose.Schema({
  workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  version: { type: Number, required: true },
  name: { type: String, required: true },
  nodes: { type: Array, default: [] },
  edges: { type: Array, default: [] },
  message: { type: String, default: '' },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // The collaboration seq (spec/28) the snapshot was taken at.
  sourceSeq: { type: Number, default: 0 },
  contentHash: { type: String, required: true },
  warnings: { type: [{ code: String, message: String, nodeId: String, _id: false }], default: [] },
  rolledBackFrom: { type: Number, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

workflowVersionSchema.index({ workflowId: 1, version: 1 }, { unique: true });

export default mongoose.model('WorkflowVersion', workflowVersionSchema);

import mongoose from 'mongoose';

/**
 * A comment thread on a workflow (spec/29 §1). It belongs to the workflow, not
 * to a version: publishing or restoring (spec/30) never moves it. When the node
 * it's pinned to disappears, the anchor is marked `detached` and keeps the last
 * known position, so the conversation outlives the node.
 */
const anchorSchema = new mongoose.Schema({
  type: { type: String, enum: ['node', 'canvas'], required: true },
  nodeId: { type: String, default: null },
  x: { type: Number, default: null },
  y: { type: Number, default: null },
  detached: { type: Boolean, default: false },
}, { _id: false });

const commentThreadSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
  anchor: { type: anchorSchema, required: true },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

commentThreadSchema.index({ workflowId: 1, resolvedAt: 1 });

export default mongoose.model('CommentThread', commentThreadSchema);

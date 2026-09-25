import mongoose from 'mongoose';

/**
 * Who hears about a workflow's failed runs (spec/29 §5).
 *
 * A workflow's creator watches it implicitly - every creation path (the
 * dashboard, a template, the demo seed) gets that for free, with no write. A
 * row exists only when someone opted in explicitly (watch button, first
 * comment) or out (`watching: false`, which is how a creator unwatches).
 */
const workflowWatchSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  watching: { type: Boolean, default: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

workflowWatchSchema.index({ workflowId: 1, userId: 1 }, { unique: true });

export default mongoose.model('WorkflowWatch', workflowWatchSchema);

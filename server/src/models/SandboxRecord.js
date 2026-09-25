import mongoose from 'mongoose';

/**
 * Every record a sandbox integration action writes (spec/27 §3): Slack messages
 * "posted", GitHub issues "opened", Sheet rows "appended", Database documents.
 * It generalises phase 2's MockRecord: one collection, scoped by workspace and
 * integration, so a sandbox is stateful (reads return what was written) without
 * introducing any new infrastructure.
 */
const sandboxRecordSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  integration: { type: String, required: true },
  // Namespaced `<integration>.<name>`, e.g. `github.issues`. NOT `collection`:
  // that's a reserved Mongoose path (it shadows Document#collection) - the same
  // reason MockRecord used collectionName.
  collectionName: { type: String, required: true },
  doc: { type: mongoose.Schema.Types.Mixed, default: {} },
  runId: { type: mongoose.Schema.Types.ObjectId, ref: 'Run', default: null },
}, { timestamps: true, minimize: false });

sandboxRecordSchema.index({ workspaceId: 1, collectionName: 1, createdAt: -1 });

export default mongoose.model('SandboxRecord', sandboxRecordSchema);

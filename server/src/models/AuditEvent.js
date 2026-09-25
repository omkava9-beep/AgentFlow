import mongoose from 'mongoose';

/**
 * Append-only record of who changed who-can-do-what (spec/34).
 *
 * The labels are snapshots taken at write time, so an entry still reads
 * correctly after the actor leaves or the target is deleted - the list never
 * needs a join.
 */
const auditEventSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  actorType: { type: String, enum: ['user', 'apiKey', 'system'], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
  actorLabel: { type: String, default: '' },
  action: { type: String, required: true },
  targetType: {
    type: String,
    enum: ['workspace', 'member', 'invitation', 'apiKey', 'connection', 'workflow', 'template'],
    required: true,
  },
  targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
  targetLabel: { type: String, default: '' },
  summary: { type: String, default: '' },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
  meta: { type: mongoose.Schema.Types.Mixed, default: null },
  ip: { type: String, default: null },
}, { timestamps: { createdAt: true, updatedAt: false }, minimize: false });

auditEventSchema.index({ workspaceId: 1, createdAt: -1, _id: -1 });
auditEventSchema.index({ workspaceId: 1, action: 1, createdAt: -1 });

// Enforced in code, not cryptographically (spec/34 §4): application code that
// tries to rewrite history fails loudly instead of quietly succeeding.
const APPEND_ONLY = 'AuditEvent is append-only';
function refuse() {
  throw new Error(APPEND_ONLY);
}

for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  auditEventSchema.pre(op, { document: false, query: true }, refuse);
}
// Document-level deleteOne() and save() on a document that already exists.
auditEventSchema.pre('deleteOne', { document: true, query: false }, refuse);
auditEventSchema.pre('save', function onSave() {
  if (!this.isNew) throw new Error(APPEND_ONLY);
});

const AuditEvent = mongoose.model('AuditEvent', auditEventSchema);

/**
 * The single sanctioned delete (spec/34 §4): the workspace cascade, once nobody
 * is a member and nobody can read the log anyway. Goes through the raw driver so
 * the model's append-only middleware stays absolute for everything else.
 */
export async function purgeWorkspaceAudit(workspaceId) {
  const id = typeof workspaceId === 'string' ? new mongoose.Types.ObjectId(workspaceId) : workspaceId;
  const { deletedCount } = await AuditEvent.collection.deleteMany({ workspaceId: id });
  return deletedCount;
}

export default AuditEvent;

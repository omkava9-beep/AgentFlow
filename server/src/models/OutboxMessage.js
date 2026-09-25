import mongoose from 'mongoose';

/**
 * Everything that "would be emailed" (spec/23 §3). Nothing is actually sent; the
 * Outbox page reads this collection back as the recipient's inbox. Generic on
 * purpose - the SMTP integration (spec/27) writes here too.
 */
const outboxMessageSchema = new mongoose.Schema({
  to: { type: String, required: true, lowercase: true, trim: true },
  subject: { type: String, required: true },
  text: { type: String, default: '' },
  kind: { type: String, enum: ['invite', 'smtp', 'notification'], required: true },
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },
  meta: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

outboxMessageSchema.index({ to: 1, createdAt: -1 });

export default mongoose.model('OutboxMessage', outboxMessageSchema);

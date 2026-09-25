import mongoose from 'mongoose';

export const NOTIFICATION_KINDS = [
  'mention', 'comment_reply', 'invite', 'run_failed', 'approval_requested', 'approval_resolved', 'role_changed',
];

/**
 * An in-app notification (spec/29 §4). One row per recipient. `groupKey` lets a
 * noisy source (a schedule failing every minute) update one unread row in place
 * - `count` goes up and `lastAt` moves - instead of piling up rows.
 *
 * `lastAt` is what lists sort on: a collapsed row that just got another failure
 * belongs at the top, even though it was created an hour ago.
 */
const notificationSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: NOTIFICATION_KINDS, required: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  link: { type: String, default: '' },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  groupKey: { type: String, default: null },
  count: { type: Number, default: 1 },
  lastAt: { type: Date, default: Date.now },
  readAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

notificationSchema.index({ userId: 1, readAt: 1, lastAt: -1 });
notificationSchema.index({ userId: 1, groupKey: 1, readAt: 1 });

export default mongoose.model('Notification', notificationSchema);

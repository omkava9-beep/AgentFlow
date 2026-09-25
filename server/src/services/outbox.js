import OutboxMessage from '../models/OutboxMessage.js';

/**
 * The project's stand-in for sending email. Real delivery is a phase-3 non-goal;
 * the message lands in the recipient's Outbox instead (spec/23 §3).
 */
export function sendMail({ to, subject, text = '', kind, workspaceId = null, meta = null }) {
  return OutboxMessage.create({ to, subject, text, kind, workspaceId, meta });
}

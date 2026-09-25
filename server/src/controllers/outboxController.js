import OutboxMessage from '../models/OutboxMessage.js';
import User from '../models/User.js';
import { HttpError } from '../middleware/errorHandler.js';

/**
 * The signed-in user's inbox of mail that "would have been sent" (spec/23 §3).
 * Strictly messages addressed to the caller's own email - showing every message
 * would leak other tenants' invites.
 */
export async function list(req, res, next) {
  try {
    const user = await User.findById(req.userId).select('email');
    if (!user) throw new HttpError(401, 'Missing or invalid token');
    const messages = await OutboxMessage.find({ to: user.email }).sort({ createdAt: -1 }).limit(200);
    res.json(messages.map((m) => ({
      id: m._id.toString(),
      subject: m.subject,
      text: m.text,
      kind: m.kind,
      meta: m.meta,
      createdAt: m.createdAt,
    })));
  } catch (err) {
    next(err);
  }
}

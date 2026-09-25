import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import { HttpError } from '../middleware/errorHandler.js';
import { isValidObjectId } from '../tenancy/scoped.js';
import { emitToUser } from '../sockets/rooms.js';
import { visibleFilter, unreadCountFor, presentNotifications } from '../services/notify.js';

/**
 * The bell (spec/29 §4). Deliberately NOT workspace-scoped: it spans every
 * workspace the caller is in, and filters on `userId` instead - you only ever
 * see, or mark, your own notifications.
 */

const PAGE = 20;

/** Cursor = `<lastAt ms>_<id>`, the list's sort order. */
function parseCursor(raw) {
  const [ms, id] = String(raw || '').split('_');
  if (!ms || !isValidObjectId(id) || !Number.isFinite(Number(ms))) return null;
  return { at: new Date(Number(ms)), id: new mongoose.Types.ObjectId(id) };
}

export async function list(req, res, next) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || PAGE, 1), 100);
    const extra = {};
    if (req.query.unread === 'true') extra.readAt = null;
    const cursor = parseCursor(req.query.before);
    const filter = await visibleFilter(req.userId, extra);
    if (cursor) {
      filter.$and = [{ $or: [{ lastAt: { $lt: cursor.at } }, { lastAt: cursor.at, _id: { $lt: cursor.id } }] }];
    }
    const docs = await Notification.find(filter).sort({ lastAt: -1, _id: -1 }).limit(limit + 1).lean();
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];
    res.json({
      items: await presentNotifications(page),
      nextCursor: docs.length > limit && last ? `${new Date(last.lastAt).getTime()}_${last._id}` : null,
      unreadCount: await unreadCountFor(req.userId),
    });
  } catch (err) {
    next(err);
  }
}

export async function markRead(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) throw new HttpError(404, 'Notification not found');
    // Only your own: someone else's id is indistinguishable from a missing one.
    const found = await Notification.findOne({ _id: req.params.id, userId: req.userId }).select('readAt');
    if (!found) throw new HttpError(404, 'Notification not found');
    if (!found.readAt) {
      found.readAt = new Date();
      await found.save();
    }
    // Keeps the bell in every other open tab in step (spec/29 socket contract).
    emitToUser(req.userId, 'notification:read', { ids: [req.params.id], unreadCount: await unreadCountFor(req.userId) });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function markAllRead(req, res, next) {
  try {
    await Notification.updateMany({ userId: req.userId, readAt: null }, { $set: { readAt: new Date() } });
    emitToUser(req.userId, 'notification:read', { ids: 'all', unreadCount: await unreadCountFor(req.userId) });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

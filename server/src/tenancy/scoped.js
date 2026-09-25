import mongoose from 'mongoose';
import { HttpError } from '../middleware/errorHandler.js';

/**
 * The only way controllers touch tenant data (spec/22 §4). A resource outside the
 * caller's workspace is indistinguishable from one that doesn't exist, so every
 * lookup here fails with the same 404 - including a malformed id, which would
 * otherwise surface as a Mongoose CastError and a 500.
 */
export function isValidObjectId(id) {
  return typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id;
}

export function scopedFilter(req, extra = {}) {
  return { workspaceId: req.workspaceId, ...extra };
}

export async function findInWorkspace(Model, id, req, { lean = false, select } = {}) {
  const notFound = new HttpError(404, `${Model.modelName} not found`);
  if (!isValidObjectId(String(id))) throw notFound;
  let query = Model.findOne({ _id: id, workspaceId: req.workspaceId });
  if (select) query = query.select(select);
  if (lean) query = query.lean();
  const doc = await query;
  if (!doc) throw notFound;
  return doc;
}

export async function createInWorkspace(Model, req, doc) {
  return Model.create({ ...doc, workspaceId: req.workspaceId, createdBy: req.userId });
}

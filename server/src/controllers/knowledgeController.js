import KnowledgeDoc from '../models/KnowledgeDoc.js';
import { addKnowledgeDoc, removeKnowledgeDoc, presentKnowledgeDoc, searchKnowledge, LIMITS } from '../services/knowledgeBase.js';
import { isValidObjectId } from '../tenancy/scoped.js';
import { HttpError } from '../middleware/errorHandler.js';

/** Knowledge Base documents (spec/27 §7), scoped to the caller's workspace. */

export async function listDocs(req, res, next) {
  try {
    const docs = await KnowledgeDoc.find({ workspaceId: req.workspaceId }).sort({ createdAt: -1 }).lean();
    res.json({ docs: docs.map((d) => presentKnowledgeDoc(d)), limits: LIMITS });
  } catch (err) {
    next(err);
  }
}

export async function getDoc(req, res, next) {
  try {
    const doc = isValidObjectId(req.params.id)
      ? await KnowledgeDoc.findOne({ _id: req.params.id, workspaceId: req.workspaceId }).lean()
      : null;
    if (!doc) throw new HttpError(404, 'Document not found');
    res.json(presentKnowledgeDoc(doc, { withText: true }));
  } catch (err) {
    next(err);
  }
}

export async function createDoc(req, res, next) {
  try {
    const doc = await addKnowledgeDoc({ workspaceId: req.workspaceId, userId: req.userId, title: req.body?.title, text: req.body?.text });
    res.status(201).json(presentKnowledgeDoc(doc));
  } catch (err) {
    next(err);
  }
}

export async function deleteDoc(req, res, next) {
  try {
    const removed = isValidObjectId(req.params.id) && await removeKnowledgeDoc({ workspaceId: req.workspaceId, id: req.params.id });
    if (!removed) throw new HttpError(404, 'Document not found');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/** Try a query from the Knowledge page, the same search the action runs. */
export async function search(req, res, next) {
  try {
    const results = await searchKnowledge(req.workspaceId, String(req.query.q || ''), { topK: req.query.topK });
    res.json({ results });
  } catch (err) {
    next(err);
  }
}

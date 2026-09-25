import KnowledgeDoc from '../models/KnowledgeDoc.js';
import { HttpError } from '../middleware/errorHandler.js';

/**
 * Knowledge Base search (spec/27 §7): an in-process TF-IDF index per workspace.
 * No embeddings and no vector database, on purpose - "no external infra". The
 * search output has the same shape a vector search would return, so the index
 * could be swapped later without touching the action.
 *
 * The index for a workspace is built on first search and dropped whenever one
 * of its documents changes; the next search rebuilds it.
 */

export const LIMITS = Object.freeze({ maxBytes: 200 * 1024, maxDocs: 50, chunkChars: 500 });

const STOPWORDS = new Set(('a an and are as at be but by for from has have i if in into is it its of on or '
  + 'our so that the their them then there these they this to was we were what when which who will with you your').split(' '));

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Paragraph-aware chunking: paragraphs are packed up to ~500 chars; long ones are split on sentences. */
export function chunkText(text, size = LIMITS.chunkChars) {
  const paragraphs = String(text || '').split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const pieces = [];
  for (const p of paragraphs) {
    if (p.length <= size) { pieces.push(p); continue; }
    let current = '';
    for (const sentence of p.split(/(?<=[.!?])\s+/)) {
      if ((current + ' ' + sentence).trim().length > size && current) {
        pieces.push(current.trim());
        current = '';
      }
      // A single sentence longer than the chunk size is hard-wrapped.
      if (sentence.length > size) {
        for (let i = 0; i < sentence.length; i += size) pieces.push(sentence.slice(i, i + size));
      } else {
        current = `${current} ${sentence}`;
      }
    }
    if (current.trim()) pieces.push(current.trim());
  }
  // Pack short neighbouring paragraphs together so tiny chunks don't dominate.
  const chunks = [];
  for (const piece of pieces) {
    const last = chunks[chunks.length - 1];
    if (last && last.length + piece.length + 2 <= size) chunks[chunks.length - 1] = `${last}\n\n${piece}`;
    else chunks.push(piece);
  }
  return chunks;
}

// workspaceId -> { chunks: [{ docId, title, chunk, weights: Map, norm }], idf: Map }
const indexes = new Map();

export function invalidateKnowledge(workspaceId) {
  indexes.delete(String(workspaceId));
}

function termCounts(tokens) {
  const counts = new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  return counts;
}

async function buildIndex(workspaceId) {
  const docs = await KnowledgeDoc.find({ workspaceId }).select('title chunks').lean();
  const entries = [];
  for (const doc of docs) {
    for (const chunk of doc.chunks || []) {
      entries.push({ docId: String(doc._id), title: doc.title, chunk, counts: termCounts(tokenize(`${doc.title} ${chunk}`)) });
    }
  }
  const df = new Map();
  for (const e of entries) for (const term of e.counts.keys()) df.set(term, (df.get(term) || 0) + 1);
  const n = entries.length;
  const idf = new Map([...df].map(([term, d]) => [term, Math.log((n + 1) / (d + 1)) + 1]));

  for (const e of entries) {
    const total = [...e.counts.values()].reduce((a, b) => a + b, 0) || 1;
    e.weights = new Map([...e.counts].map(([term, c]) => [term, (c / total) * idf.get(term)]));
    e.norm = Math.sqrt([...e.weights.values()].reduce((a, w) => a + w * w, 0)) || 1;
    delete e.counts;
  }
  const index = { entries, idf };
  indexes.set(String(workspaceId), index);
  return index;
}

/** → `[{ docId, title, chunk, score }]`, best first; `[]` for an empty workspace. */
export async function searchKnowledge(workspaceId, query, { topK = 3 } = {}) {
  const index = indexes.get(String(workspaceId)) || await buildIndex(workspaceId);
  const q = termCounts(tokenize(query));
  if (!q.size || !index.entries.length) return [];
  const qTotal = [...q.values()].reduce((a, b) => a + b, 0);
  const qWeights = new Map([...q].map(([term, c]) => [term, (c / qTotal) * (index.idf.get(term) || 0)]));
  const qNorm = Math.sqrt([...qWeights.values()].reduce((a, w) => a + w * w, 0));
  if (!qNorm) return [];

  const k = Math.max(1, Math.min(20, Number(topK) || 3));
  return index.entries
    .map((e) => {
      let dot = 0;
      for (const [term, w] of qWeights) dot += w * (e.weights.get(term) || 0);
      return { docId: e.docId, title: e.title, chunk: e.chunk, score: Number((dot / (e.norm * qNorm)).toFixed(4)) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export async function addKnowledgeDoc({ workspaceId, userId, title, text }) {
  const cleanTitle = String(title || '').trim();
  const body = String(text || '');
  if (!cleanTitle) throw new HttpError(400, 'A title is required');
  if (!body.trim()) throw new HttpError(400, 'Document text is empty');
  if (Buffer.byteLength(body, 'utf8') > LIMITS.maxBytes) throw new HttpError(413, 'Documents are limited to 200 KB');
  if (await KnowledgeDoc.countDocuments({ workspaceId }) >= LIMITS.maxDocs) {
    throw new HttpError(409, `A workspace can hold at most ${LIMITS.maxDocs} documents`);
  }
  const doc = await KnowledgeDoc.create({ workspaceId, title: cleanTitle, text: body, chunks: chunkText(body), createdBy: userId || null });
  invalidateKnowledge(workspaceId);
  return doc;
}

export async function removeKnowledgeDoc({ workspaceId, id }) {
  const result = await KnowledgeDoc.deleteOne({ _id: id, workspaceId });
  invalidateKnowledge(workspaceId);
  return result.deletedCount > 0;
}

export function presentKnowledgeDoc(doc, { withText = false } = {}) {
  return {
    id: String(doc._id),
    title: doc.title,
    chunkCount: (doc.chunks || []).length,
    bytes: Buffer.byteLength(doc.text || '', 'utf8'),
    preview: String(doc.text || '').slice(0, 200),
    ...(withText && { text: doc.text }),
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    createdAt: doc.createdAt,
  };
}

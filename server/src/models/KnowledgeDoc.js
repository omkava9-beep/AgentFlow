import mongoose from 'mongoose';

/**
 * A plain-text document in a workspace's Knowledge Base (spec/27 §7). Chunks
 * are computed on save (~500 characters along paragraph boundaries) and stored
 * with the document, so search never re-splits. The TF-IDF index over them is
 * in-process and rebuilt lazily (services/knowledgeBase.js).
 */
const knowledgeDocSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  title: { type: String, required: true, trim: true },
  text: { type: String, required: true },
  chunks: { type: [String], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

export default mongoose.model('KnowledgeDoc', knowledgeDocSchema);

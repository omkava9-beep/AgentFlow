import mongoose from 'mongoose';

const templateSchema = new mongoose.Schema({
  // null marks a built-in seed template, visible in every workspace.
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  nodes: { type: Array, default: [] },
  edges: { type: Array, default: [] },
}, { timestamps: { createdAt: true, updatedAt: false } });

export default mongoose.model('Template', templateSchema);

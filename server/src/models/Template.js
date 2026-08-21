import mongoose from 'mongoose';

const templateSchema = new mongoose.Schema({
  // null marks a built-in seed template, visible to every user.
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  nodes: { type: Array, default: [] },
  edges: { type: Array, default: [] },
}, { timestamps: { createdAt: true, updatedAt: false } });

export default mongoose.model('Template', templateSchema);

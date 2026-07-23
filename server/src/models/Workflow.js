import mongoose from 'mongoose';

const nodeSchema = new mongoose.Schema({
  id: String,
  type: { type: String, enum: ['start', 'end', 'agent', 'tool', 'condition'] },
  position: { x: Number, y: Number },
  data: mongoose.Schema.Types.Mixed,
}, { _id: false });

const edgeSchema = new mongoose.Schema({
  id: String,
  source: String,
  target: String,
  sourceHandle: String,
  label: String,
}, { _id: false });

const workflowSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, default: 'Untitled workflow' },
  nodes: { type: [nodeSchema], default: [] },
  edges: { type: [edgeSchema], default: [] },
  schedule: {
    cronExpression: { type: String, default: null },
    enabled: { type: Boolean, default: false },
  },
  webhook: {
    token: { type: String, default: null },
    enabled: { type: Boolean, default: false },
  },
  shareToken: { type: String, default: null },
}, { timestamps: true });

export default mongoose.model('Workflow', workflowSchema);

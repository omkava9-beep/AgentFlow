import mongoose from 'mongoose';

const nodeResultSchema = new mongoose.Schema({
  nodeId: String,
  status: { type: String, enum: ['pending', 'running', 'success', 'failed', 'skipped'], default: 'pending' },
  output: mongoose.Schema.Types.Mixed,
  logs: { type: [String], default: [] },
  cached: { type: Boolean, default: false },
  attempts: { type: Number, default: 1 },
  handoffTarget: { type: String, default: null },
  startedAt: Date,
  finishedAt: Date,
  durationMs: Number,
}, { _id: false });

const runSchema = new mongoose.Schema({
  workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['pending', 'running', 'success', 'failed', 'cancelled'], default: 'pending' },
  cancelReason: { type: String, enum: ['user', 'timeout', null], default: null },
  startedAt: Date,
  finishedAt: Date,
  nodeResults: { type: [nodeResultSchema], default: [] },
}, { timestamps: true });

export default mongoose.model('Run', runSchema);

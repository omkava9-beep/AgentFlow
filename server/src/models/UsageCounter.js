import mongoose from 'mongoose';

/**
 * One document per workspace per UTC day (spec/33 §6). `runs` gates the daily
 * quota and is incremented synchronously by the quota reservation; everything
 * else arrives through the 5-second `$inc` flush in services/usage.js.
 */
const usageCounterSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  day: { type: String, required: true }, // 'YYYY-MM-DD', UTC
  runs: { type: Number, default: 0 },
  nodeExecutions: { type: Number, default: 0 },
  integrationCalls: {
    live: { type: Number, default: 0 },
    sandbox: { type: Number, default: 0 },
  },
  mcpCalls: { type: Number, default: 0 },
  agentCalls: {
    mock: { type: Number, default: 0 },
    llm: { type: Number, default: 0 },
  },
  cacheHits: { type: Number, default: 0 },
  cacheMisses: { type: Number, default: 0 },
  queueWaitMsTotal: { type: Number, default: 0 },
}, { timestamps: false, minimize: false });

usageCounterSchema.index({ workspaceId: 1, day: 1 }, { unique: true });

export default mongoose.model('UsageCounter', usageCounterSchema);

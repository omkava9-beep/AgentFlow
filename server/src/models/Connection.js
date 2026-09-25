import mongoose from 'mongoose';

/**
 * A named, stored set of credentials + settings for one integration in one
 * workspace (spec/25). Secret fields live only in `credentials`, encrypted with
 * AES-256-GCM and bound (AAD) to `${workspaceId}:${_id}`; the API never returns
 * that path - only `credentialHints`.
 */
const encryptedSchema = new mongoose.Schema({
  iv: String,
  tag: String,
  ciphertext: String,
  v: Number,
}, { _id: false });

const connectionSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  integration: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  mode: { type: String, enum: ['live', 'sandbox'], default: 'live' },
  credentials: { type: encryptedSchema, default: null },
  credentialHints: { type: mongoose.Schema.Types.Mixed, default: {} },
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
  // A capability for spec/27's inbound webhooks, like a workflow's webhook token:
  // the URL is the credential, so it's stored as-is and regenerable.
  inboundToken: { type: String, default: null },
  status: { type: String, enum: ['untested', 'ok', 'error'], default: 'untested' },
  lastTestedAt: { type: Date, default: null },
  lastError: { type: String, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, minimize: false });

connectionSchema.index({ workspaceId: 1, integration: 1 });
connectionSchema.index({ workspaceId: 1, integration: 1, name: 1 }, { unique: true });
connectionSchema.index({ inboundToken: 1 }, { sparse: true });

export default mongoose.model('Connection', connectionSchema);

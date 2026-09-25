import mongoose from 'mongoose';

export const API_KEY_SCOPES = ['events:publish', 'runs:create', 'runs:read'];

/**
 * A workspace credential for external callers (spec/24). Only the SHA-256 of the
 * key is stored; the plaintext exists in exactly one response - the create call.
 */
const apiKeySchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  name: { type: String, required: true, trim: true },
  // "af_" plus the first 8 characters, so a key can be recognised in the list.
  prefix: { type: String, required: true },
  keyHash: { type: String, required: true, unique: true },
  scopes: { type: [{ type: String, enum: API_KEY_SCOPES }], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  lastUsedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

export default mongoose.model('ApiKey', apiKeySchema);

import mongoose from 'mongoose';

/**
 * A pending invitation to join a workspace (spec/23 §2). The token itself is a
 * credential and is never stored - only its SHA-256 hash, so a leaked database
 * dump can't be replayed into memberships.
 *
 * `expired` is derived on read (`pending` past `expiresAt`) and written back
 * lazily; nothing sweeps the collection.
 */
const invitationSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String, enum: ['admin', 'editor', 'viewer'], required: true },
  tokenHash: { type: String, required: true, unique: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'revoked', 'expired'], default: 'pending' },
  expiresAt: { type: Date, required: true },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

invitationSchema.index({ workspaceId: 1, email: 1, status: 1 });

export default mongoose.model('Invitation', invitationSchema);

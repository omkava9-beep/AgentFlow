import mongoose from 'mongoose';

/**
 * The tenant boundary (spec/22). Every workflow, run, template and sandbox record
 * belongs to exactly one workspace, and users reach them through a Membership.
 */
const workspaceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  // Mocked plans drive spec/33's quotas; nothing is ever charged.
  plan: { type: String, enum: ['free', 'team', 'enterprise'], default: 'free' },
  // Personal workspaces are created at registration and can't be deleted.
  personal: { type: Boolean, default: false },
  settings: {
    // spec/23's workspace-wide kill switch for read-only share links.
    publicSharing: { type: Boolean, default: true },
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Only ever set by `npm run seed:demo` (spec/36 §3), so a re-run can find and
  // replace exactly its own documents and nothing else.
  demo: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model('Workspace', workspaceSchema);

import mongoose from 'mongoose';
import { ROLES } from '../tenancy/permissions.js';

/** How a user reaches a workspace. One per (workspace, user) pair. */
const membershipSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  role: { type: String, enum: ROLES, required: true },
  // Per-person dismissal of the onboarding checklist (spec/36 §2).
  onboardingDismissedAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

export default mongoose.model('Membership', membershipSchema);

import mongoose from 'mongoose';

export const TEMPLATE_DIFFICULTIES = ['starter', 'intermediate', 'advanced'];
export const TEMPLATE_TRIGGER_TYPES = ['manual', 'schedule', 'webhook', 'event'];

const templateSchema = new mongoose.Schema({
  // null marks a built-in seed template, visible in every workspace.
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  nodes: { type: Array, default: [] },
  edges: { type: Array, default: [] },

  // Gallery metadata. Built-ins carry all of it (server/src/templates/catalog.js);
  // a workspace's own "save as template" copies leave it empty.
  // Stable id for a built-in, so re-seeding updates it in place and companions
  // can be referenced (`companion:<key>`) - null for workspace templates.
  key: { type: String, default: null },
  category: { type: String, default: null },
  tags: { type: [String], default: [] },
  // A lucide icon name, e.g. 'CreditCard'.
  icon: { type: String, default: null },
  summary: { type: String, default: '' },
  useCase: { type: String, default: '' },
  requiredIntegrations: { type: [String], default: [] },
  triggerType: { type: String, enum: [...TEMPLATE_TRIGGER_TYPES, null], default: null },
  // What "Use template" pre-fills on the new workflow's trigger (always disabled
  // until someone turns it on): { type, eventName?, cronExpression? }.
  trigger: { type: mongoose.Schema.Types.Mixed, default: null },
  // A realistic payload for a test run, shaped like the trigger's real input.
  sampleInput: { type: mongoose.Schema.Types.Mixed, default: null },
  difficulty: { type: String, enum: [...TEMPLATE_DIFFICULTIES, null], default: null },
  estimatedSetupMinutes: { type: Number, default: null },
  // A loop/sub-workflow body that ships with a parent template.
  companion: { type: Boolean, default: false },
  // Keys of the companion templates "Use template" creates first.
  companions: { type: [String], default: [] },
  order: { type: Number, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

templateSchema.index({ workspaceId: 1, key: 1 });

export default mongoose.model('Template', templateSchema);

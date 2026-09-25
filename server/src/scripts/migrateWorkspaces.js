/**
 * Moves phase-1/2 data into workspaces (spec/22 §8).
 *
 *   npm run migrate:workspaces      # also runs automatically on every boot
 *
 * Idempotent: it only touches documents that don't have a `workspaceId` yet, and
 * only creates a personal workspace for a user who has none, so running it again
 * is a no-op. It works on the raw collections rather than the models, because the
 * models no longer declare the `ownerId` paths it has to read and rename.
 */
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import Workspace from '../models/Workspace.js';
import Membership from '../models/Membership.js';
import { createPersonalWorkspace } from '../services/workspaceService.js';

const missing = { workspaceId: { $exists: false } };

export async function migrateWorkspaces({ log = console.log } = {}) {
  const db = mongoose.connection;
  const users = db.collection('users');
  const counts = { users: 0, workspaces: 0, workflows: 0, runs: 0, templates: 0, records: 0 };

  // Every user gets a display name and a personal workspace.
  for (const user of await users.find({}).toArray()) {
    if (!user.name) {
      user.name = user.email.split('@')[0];
      await users.updateOne({ _id: user._id }, { $set: { name: user.name } });
      counts.users += 1;
    }
    const personal = await Workspace.findOne({ personal: true, createdBy: user._id });
    const hasOwner = personal && await Membership.exists({ workspaceId: personal._id, userId: user._id });
    if (!hasOwner) {
      if (personal) {
        await Membership.create({ workspaceId: personal._id, userId: user._id, role: 'owner' });
      } else {
        await createPersonalWorkspace(user);
        counts.workspaces += 1;
      }
    }
  }

  const personalFor = new Map(
    (await Workspace.find({ personal: true })).map((w) => [String(w.createdBy), w._id]),
  );

  async function perOwner(collectionName, apply) {
    const collection = db.collection(collectionName);
    const owners = await collection.distinct('ownerId', { ...missing, ownerId: { $ne: null } });
    let changed = 0;
    for (const ownerId of owners) {
      const workspaceId = personalFor.get(String(ownerId));
      if (!workspaceId) {
        log(`[migrate] ${collectionName}: no user for ownerId ${ownerId}, left untouched`);
        continue;
      }
      changed += await apply(collection, ownerId, workspaceId);
    }
    return changed;
  }

  counts.workflows = await perOwner('workflows', async (c, ownerId, workspaceId) =>
    (await c.updateMany({ ...missing, ownerId }, { $set: { workspaceId }, $rename: { ownerId: 'createdBy' } })).modifiedCount);

  // Only a manual run was actually started by its owner; the rest were started
  // by a schedule, webhook or event and have no human trigger.
  counts.runs = await perOwner('runs', async (c, ownerId, workspaceId) => {
    const manual = { $or: [{ trigger: 'manual' }, { trigger: null }] };
    const a = await c.updateMany({ ...missing, ownerId, ...manual }, { $set: { workspaceId, triggeredBy: ownerId }, $unset: { ownerId: '' } });
    const b = await c.updateMany({ ...missing, ownerId }, { $set: { workspaceId, triggeredBy: null }, $unset: { ownerId: '' } });
    return a.modifiedCount + b.modifiedCount;
  });

  // Built-ins (ownerId null) stay global: workspaceId null is what makes a
  // template visible to every workspace.
  const templates = db.collection('templates');
  counts.templates += (await templates.updateMany(
    { ...missing, ownerId: null },
    { $set: { workspaceId: null, createdBy: null }, $unset: { ownerId: '' } },
  )).modifiedCount;
  counts.templates += await perOwner('templates', async (c, ownerId, workspaceId) =>
    (await c.updateMany({ ...missing, ownerId }, { $set: { workspaceId }, $rename: { ownerId: 'createdBy' } })).modifiedCount);

  counts.records = await perOwner('mockrecords', async (c, ownerId, workspaceId) =>
    (await c.updateMany({ ...missing, ownerId }, { $set: { workspaceId }, $unset: { ownerId: '' } })).modifiedCount);

  if (Object.values(counts).some(Boolean)) {
    log(`[migrate] ${counts.workspaces} personal workspaces created, ${counts.users} user names set; `
      + `${counts.workflows} workflows, ${counts.runs} runs, ${counts.templates} templates, ${counts.records} records -> workspaces`);
  }
  return counts;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { connectDB } = await import('../config/db.js');
  await connectDB();
  try {
    const counts = await migrateWorkspaces();
    if (!Object.values(counts).some(Boolean)) console.log('[migrate] nothing to migrate');
  } finally {
    await mongoose.disconnect();
  }
}

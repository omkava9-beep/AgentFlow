/**
 * Seeds the built-in workflow templates (spec/15).
 *
 *   npm run seed:templates
 *
 * Built-ins have `workspaceId: null`, which is what makes them visible in every
 * workspace without anyone having to create them. The catalogue itself lives in
 * server/src/templates/catalog.js.
 *
 * Re-running is safe: each template is upserted by its stable `key`, so the
 * script updates a built-in's graph in place. Built-ins that are no longer in
 * the catalogue (including the three phase-1 demo templates) are removed;
 * workflows already created from them are independent copies and unaffected.
 */
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import Template from '../models/Template.js';
import { BUILT_IN_TEMPLATES } from '../templates/catalog.js';

const FIELDS = [
  'key', 'name', 'description', 'nodes', 'edges', 'category', 'tags', 'icon', 'summary', 'useCase',
  'requiredIntegrations', 'triggerType', 'trigger', 'sampleInput', 'difficulty', 'estimatedSetupMinutes',
  'companion', 'companions', 'order',
];

/** Upserts every built-in and prunes retired ones. Expects an open connection. */
export async function seedBuiltInTemplates({ log = () => {} } = {}) {
  const keys = [];
  for (const template of BUILT_IN_TEMPLATES) {
    const doc = Object.fromEntries(FIELDS.map((f) => [f, template[f]]));
    // The one-line summary doubles as the description older clients show.
    doc.description = template.description || template.summary;
    const result = await Template.findOneAndUpdate(
      { workspaceId: null, key: template.key },
      { $set: { ...doc, workspaceId: null, createdBy: null } },
      // `returnDocument: 'after'` rather than `new: true` - the latter is
      // deprecated in this Mongoose version and warns on every call.
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    keys.push(template.key);
    log(`  seeded "${result.name}" (${result.nodes.length} nodes, ${result.edges.length} edges)`);
  }

  const pruned = await Template.deleteMany({ workspaceId: null, $or: [{ key: null }, { key: { $nin: keys } }] });
  if (pruned.deletedCount) log(`  removed ${pruned.deletedCount} retired built-in template(s)`);

  const total = await Template.countDocuments({ workspaceId: null });
  log(`${BUILT_IN_TEMPLATES.length} built-in template(s) upserted; ${total} now in the database.`);
  return { upserted: keys.length, pruned: pruned.deletedCount, total };
}

async function main() {
  await mongoose.connect(env.mongodbUri);
  await seedBuiltInTemplates({ log: console.log });
  await mongoose.disconnect();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(async (err) => {
    console.error('Failed to seed templates:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

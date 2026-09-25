/**
 * Moves every MockRecord into SandboxRecord (spec/27 §3) and empties the old
 * `mockrecords` collection. Idempotent: each record keeps its _id and is
 * upserted before it's removed, so a crash halfway through just resumes, and
 * every boot after the first finds nothing to do.
 *
 * Two shapes exist in `mockrecords`:
 *  - phase 2's database-write rows, with a bare collection name (`orders`) —
 *    these become integration `database`, collection `database.orders`;
 *  - rows written by the spec/26 sandbox adapter, already namespaced
 *    (`slack.messages`, `database.orders`) — kept as they are.
 *
 * Runs on boot after the workspace and tool-node migrations (it needs the
 * workspaceId the first of those assigns), and by hand:
 *   node src/scripts/migrateSandboxRecords.js
 *
 * Raw collections, not models: the MockRecord model no longer exists.
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';

// The only integrations that could have written through the spec/26 adapter
// before SandboxRecord existed.
const ADAPTER_INTEGRATIONS = new Set(['builtin', 'http', 'slack', 'email', 'database']);

function target(collectionName) {
  const name = String(collectionName || 'records');
  const prefix = name.split('.')[0];
  if (name.includes('.') && ADAPTER_INTEGRATIONS.has(prefix)) return { integration: prefix, collectionName: name };
  return { integration: 'database', collectionName: `database.${name}` };
}

export async function migrateSandboxRecords({ log = console.log } = {}) {
  const { db } = mongoose.connection;
  const existing = await db.listCollections({ name: 'mockrecords' }, { nameOnly: true }).toArray();
  if (!existing.length) return { moved: 0, skipped: 0 };

  const from = db.collection('mockrecords');
  const to = db.collection('sandboxrecords');
  let moved = 0;
  let skipped = 0;
  for await (const old of from.find({})) {
    // A record whose owner never got a workspace (spec/22's migration logs
    // those) has no tenant to belong to: leave it where it is, visibly.
    if (!old.workspaceId) {
      skipped += 1;
      continue;
    }
    const { integration, collectionName } = target(old.collectionName);
    await to.updateOne(
      { _id: old._id },
      {
        $setOnInsert: {
          workspaceId: old.workspaceId,
          integration,
          collectionName,
          doc: old.document ?? {},
          runId: old.runId ?? null,
          createdAt: old.createdAt ?? new Date(),
          updatedAt: old.createdAt ?? new Date(),
        },
      },
      { upsert: true },
    );
    await from.deleteOne({ _id: old._id });
    moved += 1;
  }

  if (moved) log(`[migrate] ${moved} MockRecord document(s) → SandboxRecord`);
  if (skipped) log(`[migrate] ${skipped} MockRecord document(s) without a workspace left in mockrecords`);
  if (!skipped && !(await from.estimatedDocumentCount())) await from.drop().catch(() => {});
  return { moved, skipped };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { env } = await import('../config/env.js');
  await mongoose.connect(env.mongodbUri);
  try {
    const result = await migrateSandboxRecords();
    console.log(`[migrate] done: ${JSON.stringify(result)}`);
  } finally {
    await mongoose.disconnect();
  }
}

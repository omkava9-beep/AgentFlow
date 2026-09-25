/**
 * Rewrites phase-2 tool nodes `{ toolType, toolConfig }` into the spec/26 shape
 * `{ integration, action, connectionId, params }` in every workflow and
 * template. Idempotent: only documents that still carry a legacy node are
 * touched, so every boot after the first is a no-op.
 *
 * Runs on boot right after the workspace migration (spec/22 §8), and by hand:
 *   npm run migrate:tool-nodes
 *
 * Raw collections, not models: the documents being fixed are exactly the ones
 * the current code no longer expects.
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { normalizeNodes } from '../integrations/normalizeToolConfig.js';

const LEGACY_NODE = { nodes: { $elemMatch: { type: 'tool', $or: [{ 'data.config.toolType': { $exists: true } }, { 'data.config.toolConfig': { $exists: true } }] } } };

async function migrateCollection(collection, log) {
  let documents = 0;
  let nodes = 0;
  let httpNodes = 0;
  const cursor = collection.find(LEGACY_NODE, { projection: { nodes: 1 } });
  for await (const doc of cursor) {
    const { nodes: next, changed } = normalizeNodes(doc.nodes);
    if (!changed) continue;
    await collection.updateOne({ _id: doc._id }, { $set: { nodes: next } });
    documents += 1;
    nodes += changed;
    httpNodes += next.filter((n, i) => n.type === 'tool' && n.data?.config?.migratedFromMock && n !== doc.nodes[i]).length;
  }
  if (documents) log(`[migrate] ${collection.collectionName}: ${nodes} tool node(s) in ${documents} document(s) → integration/action`);
  return { documents, nodes, httpNodes };
}

export async function migrateToolNodes({ log = console.log } = {}) {
  const { db } = mongoose.connection;
  const workflows = await migrateCollection(db.collection('workflows'), log);
  const templates = await migrateCollection(db.collection('templates'), log);
  const httpNodes = workflows.httpNodes + templates.httpNodes;
  // Called out because it's a behaviour change: those nodes were simulated in
  // phase 2 and now make real requests (C3).
  if (httpNodes) log(`[migrate] ${httpNodes} HTTP node(s) now make real requests (flagged migratedFromMock)`);
  return { workflows, templates };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { env } = await import('../config/env.js');
  await mongoose.connect(env.mongodbUri);
  try {
    const result = await migrateToolNodes();
    console.log(`[migrate] done: ${JSON.stringify(result)}`);
  } finally {
    await mongoose.disconnect();
  }
}

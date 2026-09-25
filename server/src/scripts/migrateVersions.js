/**
 * Publishes v1 for every non-empty workflow that has never been published
 * (spec/30 §8), so phase-2 schedules, webhooks and event subscriptions keep
 * starting runs now that triggers only run published versions. Idempotent:
 * only workflows without a `publishedVersionId` are touched.
 *
 * Runs on boot after the other migrations and before the scheduler, and by hand:
 *   npm run migrate:versions
 *
 * Raw collections for the workflow reads and writes, like the other migrations;
 * the version itself goes through the model so it gets its schema defaults.
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import WorkflowVersion from '../models/WorkflowVersion.js';
import { contentHash } from '../services/versionService.js';

export async function migrateVersions({ log = console.log } = {}) {
  const workflows = mongoose.connection.db.collection('workflows');
  const cursor = workflows.find(
    { $or: [{ publishedVersionId: { $exists: false } }, { publishedVersionId: null }], 'nodes.0': { $exists: true } },
    { projection: { workspaceId: 1, name: 1, nodes: 1, edges: 1, createdBy: 1, draftSeq: 1 } },
  );

  let published = 0;
  for await (const wf of cursor) {
    const hash = contentHash({ nodes: wf.nodes || [], edges: wf.edges || [] });
    let version;
    try {
      version = await WorkflowVersion.create({
        workflowId: wf._id,
        workspaceId: wf.workspaceId,
        version: 1,
        name: wf.name,
        nodes: wf.nodes || [],
        edges: wf.edges || [],
        message: 'Initial version (migrated)',
        publishedBy: wf.createdBy || null,
        sourceSeq: wf.draftSeq || 0,
        contentHash: hash,
      });
    } catch (err) {
      // A crash between creating v1 and pointing the workflow at it: reuse it.
      if (err.code !== 11000) throw err;
      version = await WorkflowVersion.findOne({ workflowId: wf._id, version: 1 });
    }
    await workflows.updateOne({ _id: wf._id }, {
      $set: {
        versionCounter: Math.max(1, version.version),
        publishedVersionId: version._id,
        publishedVersion: version.version,
        publishedContentHash: version.contentHash,
        publishedAt: version.createdAt,
        publishedBy: version.publishedBy,
        hasUnpublishedChanges: version.contentHash !== hash,
      },
    });
    published += 1;
  }
  if (published) log(`[migrate] published v1 for ${published} workflow(s) (spec/30)`);
  return { published };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { env } = await import('../config/env.js');
  await mongoose.connect(env.mongodbUri);
  try {
    const result = await migrateVersions();
    console.log(`[migrate] done: ${JSON.stringify(result)}`);
  } finally {
    await mongoose.disconnect();
  }
}

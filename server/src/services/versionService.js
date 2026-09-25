import crypto from 'node:crypto';
import Workflow from '../models/Workflow.js';
import WorkflowVersion from '../models/WorkflowVersion.js';
import Connection from '../models/Connection.js';
import { PermanentFailure } from '../queue/errors.js';
import { HttpError } from '../middleware/errorHandler.js';
import { stableStringify } from '../utils/stableStringify.js';
import { hub } from '../collab/hub.js';
import { getIo } from '../sockets/ioInstance.js';
import { emitToWorkspace } from '../sockets/rooms.js';
import { IntegrationRegistry } from '../integrations/IntegrationRegistry.js';
import { validateGraph } from '../engine/validateGraph.js';
import { audit } from './audit.js';

/**
 * Draft vs published versions (spec/30). The draft is whatever the canvas (and
 * the collab hub, spec/28) holds; a version is an immutable snapshot of it.
 * Everything that runs on its own - schedules, webhooks, events, the API,
 * sub-workflows - runs the published version; only the Builder's test run
 * runs the draft.
 */

// ------------------------------------------------------------------ hashing

/**
 * What a run would do: node ids, types and data, and the edges. Positions and
 * the workflow name are left out on purpose - dragging a node around isn't a
 * change anyone needs to publish (spec/30 §4).
 */
export function contentHash({ nodes = [], edges = [] }) {
  const byId = (a, b) => String(a.id).localeCompare(String(b.id));
  const content = {
    nodes: [...nodes].map((n) => ({ id: n.id, type: n.type, data: n.data ?? null })).sort(byId),
    edges: [...edges].map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, label: e.label ?? null })).sort(byId),
  };
  return crypto.createHash('sha1').update(stableStringify(content)).digest('hex');
}

const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

// ------------------------------------------------------------------ reading

/** The published version of a workflow (doc or id), or null if it was never published. */
export async function getPublished(workflowOrId) {
  const workflow = typeof workflowOrId === 'object' && workflowOrId !== null && '_id' in workflowOrId
    ? workflowOrId
    : await Workflow.findById(workflowOrId).select('publishedVersionId workspaceId').lean(); // tenancy: capability lookup (id from our own records)
  if (!workflow?.publishedVersionId) return null;
  return WorkflowVersion.findOne({ _id: workflow.publishedVersionId, workspaceId: workflow.workspaceId }).lean();
}

/**
 * The graph a run executed (spec/30 §2): its version for published runs, its
 * snapshot for draft (test) runs. Re-runs, retries (spec/35), resuming a
 * waiting run (spec/32) and the run monitor all read the run's own graph
 * through this, never the current draft.
 *
 * → `{ nodes, edges, name, versionId, versionNumber, isDraft }`. Throws
 * PermanentFailure for runs from before versioning, which recorded neither.
 */
export async function loadRunGraph(run) {
  if (run?.versionId) {
    const version = await WorkflowVersion.findOne({ _id: run.versionId, workspaceId: run.workspaceId }).lean();
    if (!version) throw new PermanentFailure('The version this run executed no longer exists');
    return {
      name: version.name,
      nodes: version.nodes,
      edges: version.edges,
      versionId: String(version._id),
      versionNumber: version.version,
      isDraft: false,
    };
  }
  if (run?.graph?.nodes) {
    return { name: run.graph.name ?? null, nodes: run.graph.nodes, edges: run.graph.edges || [], versionId: null, versionNumber: null, isDraft: true };
  }
  throw new PermanentFailure('This run has no recorded graph (it predates versioning)');
}

/**
 * Which graph a new run executes (spec/30 §2). `source` is 'draft' for the
 * Builder's test run and 'published' for everything else. `replay` pins a
 * previous run's graph (spec/35's re-run / retry).
 *
 * → `{ ok: true, graph: { name, nodes, edges }, isDraft, versionId, versionNumber }`
 *   or `{ ok: false, reason: 'not-published' }`.
 */
export async function resolveRunGraph(workflow, { source = 'published', replay = null } = {}) {
  if (replay) {
    const pinned = await loadRunGraph({
      versionId: replay.versionId,
      graph: replay.graph,
      workspaceId: replay.workspaceId || workflow.workspaceId,
    });
    return {
      ok: true,
      graph: { name: pinned.name ?? workflow.name, nodes: pinned.nodes, edges: pinned.edges },
      isDraft: pinned.isDraft,
      versionId: pinned.versionId,
      versionNumber: pinned.versionNumber,
    };
  }

  if (source === 'draft') {
    // Includes edits a collaborator made seconds ago (spec/28 §1): flush, then
    // read the hub's draft rather than a stale database copy.
    await hub.flushBeforeRead(workflow._id);
    const live = hub.getDraft(workflow._id);
    const graph = live
      ? { name: live.name, nodes: live.nodes, edges: live.edges }
      : { name: workflow.name, nodes: plain(workflow.nodes), edges: plain(workflow.edges) };
    return { ok: true, graph, isDraft: true, versionId: null, versionNumber: null };
  }

  const version = await getPublished(workflow);
  if (!version) return { ok: false, reason: 'not-published' };
  return {
    ok: true,
    graph: { name: version.name, nodes: version.nodes, edges: version.edges },
    isDraft: false,
    versionId: version._id,
    versionNumber: version.version,
  };
}

// ------------------------------------------------------------------ validation

/** The server-side context validateGraph needs: tools, connections, sibling workflows. */
async function validationContext(workspaceId) {
  const [connections, workflows] = await Promise.all([
    Connection.find({ workspaceId }).select('_id integration name status config.toolsSnapshot').lean(),
    Workflow.find({ workspaceId }).select('_id name publishedVersion').lean(),
  ]);
  return {
    integrations: IntegrationRegistry.list(),
    connections: connections.map((c) => ({
      id: String(c._id), integration: c.integration, name: c.name, status: c.status,
      // spec/37: an MCP connection's discovered tools, for the "no longer offered" check.
      ...(c.config?.toolsSnapshot && { config: { toolsSnapshot: c.config.toolsSnapshot } }),
    })),
    workflows: workflows.map((w) => ({ _id: String(w._id), name: w.name, publishedVersion: w.publishedVersion ?? null })),
  };
}

export async function validateForPublish(workflow, graph) {
  const context = await validationContext(workflow.workspaceId);
  return validateGraph({ nodes: graph.nodes, edges: graph.edges, currentWorkflowId: String(workflow._id), ...context });
}

// ------------------------------------------------------------------ live draft state

const publishedHashes = new Map(); // workflowId -> hash | null (a cache of Workflow.publishedContentHash)
const lastFlags = new Map();
const pendingRefresh = new Map();

function emitVersionEvent(workflowId, workspaceId, event, payload) {
  const body = { workflowId: String(workflowId), ...payload };
  try {
    getIo().to(`workflow:${workflowId}`).emit(event, body);
  } catch {
    // socket layer not initialized (scripts) - nothing to tell
  }
  emitToWorkspace(String(workspaceId), event, body);
}

/**
 * Recomputes `hasUnpublishedChanges` for a workflow and, when it flips,
 * persists it and tells the canvas and the dashboard (spec/30 §4).
 */
export async function refreshDraftState(workflowId) {
  const id = String(workflowId);
  const stored = await Workflow.findById(id).select('workspaceId nodes edges publishedContentHash hasUnpublishedChanges').lean(); // tenancy: capability lookup (hub hook, id from our session)
  if (!stored) return null;
  const draft = hub.getDraft(id) || stored;
  publishedHashes.set(id, stored.publishedContentHash ?? null);
  const flag = draftDiffers(draft, stored.publishedContentHash);
  const previous = lastFlags.has(id) ? lastFlags.get(id) : Boolean(stored.hasUnpublishedChanges);
  lastFlags.set(id, flag);
  if (flag !== Boolean(stored.hasUnpublishedChanges)) {
    await Workflow.updateOne({ _id: id }, { $set: { hasUnpublishedChanges: flag } });
  }
  if (flag !== previous) emitVersionEvent(id, stored.workspaceId, 'version:draft_state', { hasUnpublishedChanges: flag });
  return flag;
}

function draftDiffers(draft, publishedHash) {
  // An empty, never-published workflow has nothing to publish.
  if (!publishedHash) return Boolean(draft?.nodes?.length);
  return contentHash(draft) !== publishedHash;
}

/** Fresh `hasUnpublishedChanges` for a REST read, from the live draft when there is one. */
export function hasUnpublishedChanges(workflow) {
  const draft = hub.getDraft(workflow._id) || workflow;
  return draftDiffers(draft, workflow.publishedContentHash);
}

// Coalesced per workflow: a burst of keystrokes costs one hash, not dozens.
hub.onDraftChanged((workflowId) => {
  const id = String(workflowId);
  if (pendingRefresh.has(id)) return;
  pendingRefresh.set(id, setTimeout(() => {
    pendingRefresh.delete(id);
    refreshDraftState(id).catch((err) => console.error('[versions] draft state refresh failed:', err.message));
  }, 150));
  pendingRefresh.get(id).unref?.();
});

// ------------------------------------------------------------------ publishing

// Publishes of one workflow run one at a time, so two simultaneous identical
// publishes can't both pass the "nothing to publish" check (spec/30 edge cases).
const locks = new Map();
function withWorkflowLock(workflowId, fn) {
  const id = String(workflowId);
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(id, next.catch(() => {}));
  return next;
}

const warningsOf = (list) => list.map((w) => ({ code: String(w.id || '').split(':')[0], message: w.message, ...(w.nodeId && { nodeId: w.nodeId }) }));

async function createVersion(workflow, { graph, message, publishedBy, sourceSeq, warnings, rolledBackFrom = null }) {
  const counter = await Workflow.findOneAndUpdate(
    { _id: workflow._id, workspaceId: workflow.workspaceId },
    { $inc: { versionCounter: 1 } },
    { returnDocument: 'after' },
  ).select('versionCounter').lean();
  if (!counter) throw new HttpError(404, 'Workflow not found');

  const hash = contentHash(graph);
  const version = await WorkflowVersion.create({
    workflowId: workflow._id,
    workspaceId: workflow.workspaceId,
    version: counter.versionCounter,
    name: graph.name,
    nodes: plain(graph.nodes),
    edges: plain(graph.edges),
    message: String(message || '').slice(0, 500),
    publishedBy,
    sourceSeq: sourceSeq ?? 0,
    contentHash: hash,
    warnings,
    rolledBackFrom,
  });

  // The draft may have moved on since the snapshot (or, for a rollback, may be
  // entirely different), so the flag is recomputed rather than assumed false.
  const draft = hub.getDraft(workflow._id) || (await Workflow.findById(workflow._id).select('nodes edges').lean()); // tenancy: capability lookup (workflow already resolved in-workspace)
  const flag = contentHash(draft) !== hash;
  await Workflow.updateOne(
    { _id: workflow._id, workspaceId: workflow.workspaceId },
    {
      $set: {
        publishedVersionId: version._id,
        publishedVersion: version.version,
        publishedContentHash: hash,
        publishedAt: version.createdAt,
        publishedBy,
        hasUnpublishedChanges: flag,
      },
    },
  );
  publishedHashes.set(String(workflow._id), hash);
  lastFlags.set(String(workflow._id), flag);
  return { version, hasUnpublishedChanges: flag };
}

function presentVersion(version, { liveVersionId = null } = {}) {
  return {
    id: String(version._id),
    version: version.version,
    name: version.name,
    message: version.message,
    publishedBy: version.publishedBy && typeof version.publishedBy === 'object' && 'email' in version.publishedBy
      ? { id: String(version.publishedBy._id), name: version.publishedBy.name || version.publishedBy.email }
      : version.publishedBy ? { id: String(version.publishedBy), name: null } : null,
    createdAt: version.createdAt,
    warnings: version.warnings || [],
    warningsCount: (version.warnings || []).length,
    nodeCount: (version.nodes || []).length,
    isLive: liveVersionId !== null && String(version._id) === String(liveVersionId),
    rolledBackFrom: version.rolledBackFrom ?? null,
    sourceSeq: version.sourceSeq,
  };
}

/**
 * Publish the current draft (spec/30 §3). → `{ status, body }` so the
 * controller can return 422's `{ errors, warnings }` intact.
 */
export function publish(req, workflow, { message = '', acknowledgeWarnings = false } = {}) {
  return withWorkflowLock(workflow._id, async () => {
    // A snapshot at a known seq: ops arriving after this belong to the draft only.
    await hub.flushBeforeRead(workflow._id);
    const live = hub.getDraft(workflow._id);
    const fresh = live ? null : await Workflow.findById(workflow._id).lean(); // tenancy: capability lookup (workflow already resolved in-workspace)
    const graph = live
      ? { name: live.name, nodes: live.nodes, edges: live.edges }
      : { name: fresh.name, nodes: fresh.nodes, edges: fresh.edges };
    const sourceSeq = live ? live.draftSeq : fresh.draftSeq;

    const { errors, warnings } = await validateForPublish(workflow, graph);
    if (errors.length) return { status: 422, body: { error: 'Fix the errors before publishing', errors, warnings } };
    if (warnings.length && !acknowledgeWarnings) {
      return { status: 422, body: { error: 'Publishing with warnings needs acknowledgeWarnings: true', errors: [], warnings, needsAcknowledgement: true } };
    }

    const current = await Workflow.findById(workflow._id).select('publishedContentHash').lean(); // tenancy: capability lookup (workflow already resolved in-workspace)
    if (current?.publishedContentHash && current.publishedContentHash === contentHash(graph)) {
      return { status: 409, body: { error: 'Nothing to publish' } };
    }

    const { version, hasUnpublishedChanges: flag } = await createVersion(workflow, {
      graph, message, publishedBy: req.userId, sourceSeq, warnings: warningsOf(warnings),
    });
    announcePublished(req, workflow, version, flag);
    return { status: 201, body: { version: presentVersion(version, { liveVersionId: version._id }), hasUnpublishedChanges: flag } };
  });
}

/**
 * Roll back = publish version n's content as a NEW version (spec/30 §6). The
 * draft is untouched, and the "nothing to publish" check doesn't apply: this is
 * the "production is broken, put v2 back now" button.
 */
export function rollback(req, workflow, versionNumber, { message = '' } = {}) {
  return withWorkflowLock(workflow._id, async () => {
    const source = await findVersion(workflow, versionNumber);
    const graph = { name: source.name, nodes: source.nodes, edges: source.edges };
    const { errors, warnings } = await validateForPublish(workflow, graph);
    // It was publishable once; a hard error now (e.g. a migrated v1 with no
    // Start node) would publish something that can't run at all.
    if (errors.length) return { status: 422, body: { error: `v${source.version} can't be published as it is`, errors, warnings } };

    const { version, hasUnpublishedChanges: flag } = await createVersion(workflow, {
      graph,
      message: message || `Rolled back to v${source.version}`,
      publishedBy: req.userId,
      sourceSeq: source.sourceSeq,
      warnings: warningsOf(warnings),
      rolledBackFrom: source.version,
    });
    announcePublished(req, workflow, version, flag);
    return { status: 201, body: { version: presentVersion(version, { liveVersionId: version._id }), hasUnpublishedChanges: flag } };
  });
}

function announcePublished(req, workflow, version, flag) {
  emitVersionEvent(workflow._id, workflow.workspaceId, 'version:published', {
    version: version.version,
    by: { userId: String(req.userId) },
    message: version.message,
    ...(version.rolledBackFrom && { rolledBackFrom: version.rolledBackFrom }),
  });
  emitVersionEvent(workflow._id, workflow.workspaceId, 'version:draft_state', { hasUnpublishedChanges: flag });
  audit(req, 'workflow.published', { type: 'workflow', id: String(workflow._id), name: workflow.name }, {
    meta: { version: version.version, ...(version.rolledBackFrom && { rolledBackFrom: version.rolledBackFrom }) },
  });
}

/**
 * Restore = replace the DRAFT with version n (spec/30 §6). Nothing is
 * published; collaborators get a `collab:snapshot { reason: 'restored', version }`.
 */
export async function restore(req, workflow, versionNumber) {
  const source = await findVersion(workflow, versionNumber);
  const draftSeq = await hub.replace(
    workflow,
    { name: source.name, nodes: plain(source.nodes), edges: plain(source.edges) },
    { by: { userId: String(req.userId) }, reason: 'restored', extra: { version: source.version } },
  );
  audit(req, 'workflow.restored', { type: 'workflow', id: String(workflow._id), name: workflow.name }, { meta: { version: source.version } });
  await refreshDraftState(workflow._id);
  return { draftSeq, version: source.version };
}

async function findVersion(workflow, versionNumber) {
  const n = Number(versionNumber);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Version not found');
  const version = await WorkflowVersion.findOne({ workflowId: workflow._id, workspaceId: workflow.workspaceId, version: n }).lean();
  if (!version) throw new HttpError(404, 'Version not found');
  return version;
}

export async function listVersions(workflow, { page = 1, limit = 50 } = {}) {
  const versions = await WorkflowVersion.find({ workflowId: workflow._id, workspaceId: workflow.workspaceId })
    .sort({ version: -1 })
    .skip((Math.max(1, page) - 1) * limit)
    .limit(limit)
    .populate('publishedBy', 'name email')
    .lean();
  return versions.map((v) => presentVersion(v, { liveVersionId: workflow.publishedVersionId }));
}

export async function getVersion(workflow, versionNumber) {
  const version = await findVersion(workflow, versionNumber);
  const populated = await WorkflowVersion.populate(version, { path: 'publishedBy', select: 'name email' });
  return { ...presentVersion(populated, { liveVersionId: workflow.publishedVersionId }), nodes: version.nodes, edges: version.edges };
}

// ------------------------------------------------------------------ diff

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => stableStringify(a ?? null) === stableStringify(b ?? null);

/** Paths (arrays of keys) where two values differ. Arrays compare as whole values, like spec/28's ops. */
function diffPaths(a, b, prefix = []) {
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].sort().flatMap((k) => diffPaths(a[k], b[k], [...prefix, k]));
  }
  return same(a, b) ? [] : [prefix];
}

/**
 * Id-keyed diff of two graphs (spec/30 §5). Config paths are relative to
 * `data.config`; other data keys are prefixed with `data`. Position-only
 * changes land in `moved`, not `changed`.
 */
export function diffGraphs(from, to) {
  const aNodes = new Map((from.nodes || []).map((n) => [n.id, n]));
  const bNodes = new Map((to.nodes || []).map((n) => [n.id, n]));
  const nodes = { added: [], removed: [], changed: [], moved: [] };
  for (const id of bNodes.keys()) if (!aNodes.has(id)) nodes.added.push(id);
  for (const [id, a] of aNodes) {
    const b = bNodes.get(id);
    if (!b) { nodes.removed.push(id); continue; }
    const paths = [];
    if (a.type !== b.type) paths.push(['type']);
    const { config: aConfig, ...aData } = a.data || {};
    const { config: bConfig, ...bData } = b.data || {};
    paths.push(...diffPaths(aConfig || {}, bConfig || {}));
    paths.push(...diffPaths(aData, bData, ['data']));
    if (paths.length) nodes.changed.push({ id, paths });
    if ((a.position?.x ?? 0) !== (b.position?.x ?? 0) || (a.position?.y ?? 0) !== (b.position?.y ?? 0)) nodes.moved.push(id);
  }

  const aEdges = new Map((from.edges || []).map((e) => [e.id, e]));
  const bEdges = new Map((to.edges || []).map((e) => [e.id, e]));
  const edges = { added: [], removed: [], changed: [] };
  for (const id of bEdges.keys()) if (!aEdges.has(id)) edges.added.push(id);
  for (const [id, a] of aEdges) {
    const b = bEdges.get(id);
    if (!b) { edges.removed.push(id); continue; }
    const fields = ['source', 'target', 'sourceHandle', 'label'].filter((f) => (a[f] ?? null) !== (b[f] ?? null));
    if (fields.length) edges.changed.push({ id, fields });
  }
  return { nodes, edges, nameChanged: (from.name ?? null) !== (to.name ?? null) };
}

/** `from`/`to` are version numbers or 'draft'. Defaults: live version → draft. */
export async function diff(workflow, { from, to } = {}) {
  const resolve = async (ref) => {
    if (ref === undefined || ref === null || ref === '' || ref === 'live') {
      if (!workflow.publishedVersion) throw new HttpError(404, 'This workflow has never been published');
      ref = workflow.publishedVersion;
    }
    if (ref === 'draft') {
      await hub.flushBeforeRead(workflow._id);
      const live = hub.getDraft(workflow._id);
      const fresh = live || (await Workflow.findById(workflow._id).select('name nodes edges').lean()); // tenancy: capability lookup (workflow already resolved in-workspace)
      return { label: 'draft', version: null, name: fresh.name, nodes: plain(fresh.nodes), edges: plain(fresh.edges) };
    }
    const v = await findVersion(workflow, ref);
    return { label: `v${v.version}`, version: v.version, name: v.name, nodes: v.nodes, edges: v.edges };
  };
  const [a, b] = await Promise.all([resolve(from), resolve(to ?? 'draft')]);
  return { from: a, to: b, diff: diffGraphs(a, b) };
}

// ------------------------------------------------------------------ runs

/** The graph to show for a run in the monitor, or null for pre-versioning runs. */
export async function graphForRun(run) {
  try {
    const g = await loadRunGraph(run);
    return { name: g.name, nodes: g.nodes, edges: g.edges };
  } catch {
    return null;
  }
}

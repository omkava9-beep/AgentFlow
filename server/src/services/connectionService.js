import mongoose from 'mongoose';
import Connection from '../models/Connection.js';
import Workflow from '../models/Workflow.js';
import { env } from '../config/env.js';
import { encrypt, decrypt, connectionAad, hintFor, VaultError } from '../secrets/vault.js';
import { PermanentFailure } from '../queue/errors.js';
import { HttpError } from '../middleware/errorHandler.js';
import { generateToken } from '../utils/token.js';

/**
 * Connections (spec/25): named, encrypted credentials for one integration in one
 * workspace. Plaintext exists only in the object `resolveConnection()` hands the
 * engine at the moment a node runs - never in an API response, a cache entry, a
 * node result or a socket event.
 */

/** The reserved "no account" value any node picker can choose (spec/25 §2). */
export const SANDBOX_CONNECTION_ID = 'sandbox';

function virtualSandbox() {
  return { id: SANDBOX_CONNECTION_ID, integration: null, name: 'Sandbox', mode: 'sandbox', credentials: {}, config: {}, status: 'ok' };
}

// The registry is written alongside this module (spec/26); import it on first
// use so this file doesn't pin the load order of the integrations package.
let registryPromise = null;
async function registry() {
  registryPromise ||= import('../integrations/IntegrationRegistry.js').then((m) => m.IntegrationRegistry);
  return registryPromise;
}

export async function getManifest(integrationId) {
  const manifest = (await registry()).get(integrationId);
  if (!manifest) throw new HttpError(400, `Unknown integration: ${integrationId}`);
  return manifest;
}

/** Live is only offered when at least one action has a real adapter. */
export function hasLiveActions(manifest) {
  // Dynamic actions (MCP, spec/37) are live by construction: they call a real server.
  if (typeof manifest.dynamicActions === 'function') return true;
  return (manifest.actions || []).some((a) => typeof a.live === 'function' || a.liveCapable === true);
}

function hasInbound(manifest) {
  return Boolean(manifest.inbound || manifest.hasInbound);
}

const authFields = (manifest) => manifest.auth?.fields || [];
const isBlank = (v) => v === undefined || v === '';

/**
 * Splits submitted values by the manifest's auth fields: `secret: true` goes to
 * the vault, everything else to plain `config`. A value may arrive in either
 * `credentials` or `config` - the manifest, not the client, decides where it is
 * stored. Unknown keys are rejected rather than silently kept.
 */
function splitSubmitted(manifest, { credentials = {}, config = {} } = {}) {
  const byKey = new Map(authFields(manifest).map((f) => [f.key, f]));
  const secret = {};
  const plain = {};
  for (const source of [config, credentials]) {
    if (source === null || typeof source !== 'object' || Array.isArray(source)) {
      throw new HttpError(400, 'credentials and config must be objects');
    }
    for (const [key, value] of Object.entries(source)) {
      const field = byKey.get(key);
      if (!field) throw new HttpError(400, `Unknown field "${key}" for ${manifest.name || manifest.id}`);
      (field.secret ? secret : plain)[key] = value;
    }
  }
  return { secret, plain };
}

function requireFields(manifest, secretValues, configValues) {
  for (const field of authFields(manifest)) {
    if (!field.required) continue;
    const value = field.secret ? secretValues[field.key] : configValues[field.key];
    if (isBlank(value) || value === null) throw new HttpError(400, `${field.label || field.key} is required`);
  }
}

function hintsFor(secretValues) {
  return Object.fromEntries(Object.entries(secretValues).map(([k, v]) => [k, hintFor(v)]));
}

function decryptCredentials(doc) {
  if (!doc.credentials) return {};
  return decrypt(doc.credentials, connectionAad(doc.workspaceId, doc._id));
}

/**
 * Public shape (spec/25 API). Never includes `credentials`. `stripped` is the
 * viewer form: name and status only, so a read-only config panel can still say
 * which connection a node uses.
 */
export function presentConnection(doc, { slug = null, stripped = false } = {}) {
  const base = {
    id: doc._id.toString(),
    integration: doc.integration,
    name: doc.name,
    mode: doc.mode,
    status: doc.status,
  };
  if (stripped) return base;
  return {
    ...base,
    credentialHints: doc.credentialHints || {},
    config: doc.config || {},
    lastTestedAt: doc.lastTestedAt,
    lastError: doc.lastError,
    inboundUrl: doc.inboundToken && slug
      ? `${env.publicBaseUrl}/api/w/${slug}/hooks/${doc.integration}/${doc.inboundToken}`
      : null,
    createdBy: doc.createdBy ? doc.createdBy.toString() : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function createConnection({ workspaceId, userId, integration, name, mode, credentials, config }) {
  const manifest = await getManifest(integration);
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) throw new HttpError(400, 'A connection name is required');

  const { secret, plain } = splitSubmitted(manifest, { credentials, config });
  // Blank secrets on create simply aren't set.
  for (const key of Object.keys(secret)) if (isBlank(secret[key]) || secret[key] === null) delete secret[key];
  requireFields(manifest, secret, plain);
  // Integration-specific rules the field list can't express (spec/37: a local
  // MCP server takes an allowlistId, never a command).
  manifest.validateConnection?.({ config: plain, credentials: secret });

  const live = hasLiveActions(manifest);
  const nextMode = mode ?? (live ? 'live' : 'sandbox');
  assertMode(manifest, nextMode);

  // The id has to exist before the first encryption: it is part of the AAD.
  const _id = new mongoose.Types.ObjectId();
  const doc = new Connection({
    _id,
    workspaceId,
    integration,
    name: trimmed,
    mode: nextMode,
    credentials: Object.keys(secret).length ? encrypt(secret, connectionAad(workspaceId, _id)) : null,
    credentialHints: hintsFor(secret),
    config: plain,
    inboundToken: hasInbound(manifest) ? generateToken() : null,
    createdBy: userId,
  });
  try {
    await doc.save();
  } catch (err) {
    if (err?.code === 11000) throw new HttpError(409, `A ${manifest.name || integration} connection named "${trimmed}" already exists`);
    throw err;
  }
  return doc;
}

function assertMode(manifest, mode) {
  if (!['live', 'sandbox'].includes(mode)) throw new HttpError(400, "mode must be 'live' or 'sandbox'");
  if (mode === 'live' && !hasLiveActions(manifest)) {
    throw new HttpError(400, `${manifest.name || manifest.id} has no live actions - use sandbox mode`);
  }
}

/**
 * PATCH merge semantics: a present value replaces, an omitted (or blank secret)
 * value keeps, `null` clears. That's how "leave blank to keep the current token"
 * works without the client ever holding the token.
 *
 * Returns `{ doc, changed: { name, mode, config: [...keys], credentials: [...keys] } }`
 * so the caller can audit field *names* - never values.
 */
export async function updateConnection(doc, { name, mode, config, credentials }) {
  const manifest = await getManifest(doc.integration);
  const changed = { name: false, mode: false, config: [], credentials: [] };

  if (name !== undefined) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) throw new HttpError(400, 'A connection name is required');
    if (trimmed !== doc.name) { doc.name = trimmed; changed.name = true; }
  }
  if (mode !== undefined && mode !== doc.mode) {
    assertMode(manifest, mode);
    doc.mode = mode;
    changed.mode = true;
  }

  if (config !== undefined || credentials !== undefined) {
    const { secret, plain } = splitSubmitted(manifest, { credentials: credentials || {}, config: config || {} });

    const nextConfig = { ...(doc.config || {}) };
    for (const [key, value] of Object.entries(plain)) {
      if (value === null) delete nextConfig[key];
      else nextConfig[key] = value;
      changed.config.push(key);
    }

    let nextSecret = null;
    const secretKeys = Object.keys(secret).filter((k) => !isBlank(secret[k]));
    if (secretKeys.length) {
      try {
        nextSecret = decryptCredentials(doc);
      } catch (err) {
        // Undecryptable (key changed): the only way forward is re-entering them,
        // so start from empty rather than refusing the update.
        if (!(err instanceof VaultError)) throw err;
        nextSecret = {};
      }
      for (const key of secretKeys) {
        if (secret[key] === null) delete nextSecret[key];
        else nextSecret[key] = secret[key];
        changed.credentials.push(key);
      }
    }

    const secretForCheck = nextSecret ?? Object.fromEntries(Object.keys(doc.credentialHints || {}).map((k) => [k, '(set)']));
    requireFields(manifest, secretForCheck, nextConfig);
    manifest.validateConnection?.({ config: nextConfig, credentials: secretForCheck });

    if (changed.config.length) {
      doc.config = nextConfig;
      doc.markModified('config');
    }
    if (nextSecret) {
      doc.credentials = Object.keys(nextSecret).length ? encrypt(nextSecret, connectionAad(doc.workspaceId, doc._id)) : null;
      doc.credentialHints = hintsFor(nextSecret);
      doc.markModified('credentialHints');
    }
  }

  // Anything that changes what a test would exercise invalidates the last result.
  if (changed.credentials.length || changed.config.length || changed.mode) {
    doc.status = 'untested';
    doc.lastError = null;
  }

  try {
    await doc.save();
  } catch (err) {
    if (err?.code === 11000) throw new HttpError(409, `A connection named "${doc.name}" already exists for this integration`);
    throw err;
  }
  return { doc, changed };
}

/**
 * Runs the manifest's optional `test(ctx)` and records the outcome. Sandbox-mode
 * connections always test ok: there's nothing real to reach.
 */
export async function testConnection(doc) {
  let status = 'ok';
  let lastError = null;
  let detail;

  if (doc.mode !== 'sandbox') {
    try {
      const resolved = toResolved(doc, decryptCredentials(doc));
      const result = await runManifestTest(doc.integration, resolved, doc.workspaceId.toString());
      if (result && result.ok === false) {
        status = 'error';
        lastError = String(result.message || result.detail || 'Connection test failed');
      } else {
        detail = result?.message || result?.detail;
      }
    } catch (err) {
      status = 'error';
      lastError = err instanceof VaultError ? "Credentials can't be decrypted — re-enter them" : String(err?.message || err);
      // Never echo a token a provider reflected back in its error message.
      const resolvedSecrets = safeSecretValues(doc);
      for (const s of resolvedSecrets) lastError = lastError.split(s).join('••••');
    }
  } else {
    detail = 'Sandbox mode — no real account is contacted';
  }

  doc.status = status;
  doc.lastError = lastError;
  doc.lastTestedAt = new Date();
  await doc.save();
  return { status, lastError, ...(detail ? { detail } : {}) };
}

/**
 * Prefers the registry's own `testConnection` (spec/26); falls back to calling
 * the manifest's optional `test(ctx)` directly, and to "nothing to test" when an
 * integration declares none.
 */
async function runManifestTest(integration, connection, workspaceId) {
  const reg = await registry();
  if (typeof reg.testConnection === 'function') return reg.testConnection(integration, { connection, workspaceId });
  const manifest = reg.get(integration);
  if (typeof manifest?.test !== 'function') return { ok: true, message: 'No connection test for this integration' };
  const { safeRequest } = await import('../net/safeRequest.js');
  return manifest.test({ connection, workspaceId, params: {}, input: null, logs: [], http: safeRequest });
}

function safeSecretValues(doc) {
  try {
    return secretValuesOf({ credentials: decryptCredentials(doc) });
  } catch {
    return [];
  }
}

export async function regenerateInboundToken(doc) {
  const manifest = await getManifest(doc.integration);
  if (!hasInbound(manifest)) throw new HttpError(400, `${manifest.name || doc.integration} has no inbound webhooks`);
  doc.inboundToken = generateToken();
  await doc.save();
  return doc;
}

function toResolved(doc, credentials) {
  return {
    id: doc._id.toString(),
    integration: doc.integration,
    name: doc.name,
    mode: doc.mode,
    credentials,
    config: doc.config || {},
    status: doc.status,
  };
}

/**
 * Execution-time lookup (spec/25 §3). Scoped by workspace, so a node in A that
 * references B's connection id gets "not found" - a PermanentFailure, since no
 * retry will ever make it resolve.
 */
export async function resolveConnection(workspaceId, connectionId, integration = null) {
  if (connectionId === null || connectionId === undefined || connectionId === '') return null;
  if (connectionId === SANDBOX_CONNECTION_ID) return virtualSandbox();

  const id = String(connectionId);
  const doc = mongoose.Types.ObjectId.isValid(id)
    ? await Connection.findOne({ _id: id, workspaceId })
    : null;
  if (!doc) throw new PermanentFailure('Connection not found');
  if (integration && doc.integration !== integration) {
    throw new PermanentFailure(`Connection "${doc.name}" is for ${doc.integration}, not ${integration}`);
  }

  try {
    return toResolved(doc, decryptCredentials(doc));
  } catch (err) {
    if (!(err instanceof VaultError)) throw err;
    // Record it so the connections list shows why, then fail the node for good.
    await Connection.updateOne({ _id: doc._id }, { $set: { status: 'error', lastError: "Credentials can't be decrypted — re-enter them" } });
    throw new PermanentFailure("Credentials can't be decrypted — re-enter them");
  }
}

/** Every secret string worth scrubbing from logs and outputs (feed to buildRedactor). */
export function secretValuesOf(resolved) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(resolved?.credentials || {});
  return out;
}

const nodeConnectionId = (node) => node?.data?.config?.connectionId ?? null;

/**
 * Workflows (and, once spec/30 exists, published versions) whose nodes reference
 * this connection. → [{ workflowId, workflowName, nodeIds, version? }]
 */
export async function findUsage(workspaceId, connectionId) {
  const id = String(connectionId);
  const match = { workspaceId, 'nodes.data.config.connectionId': { $in: [id, new mongoose.Types.ObjectId(id)] } };
  const collect = (docs, extra = () => ({})) => docs.map((wf) => ({
    workflowId: String(wf.workflowId || wf._id),
    workflowName: wf.name,
    nodeIds: (wf.nodes || []).filter((n) => String(nodeConnectionId(n)) === id).map((n) => n.id),
    ...extra(wf),
  }));

  const usage = collect(await Workflow.find(match).select('name nodes').lean());
  // Published versions count too (spec/25 edge cases), when that model exists.
  const Version = mongoose.models.WorkflowVersion;
  if (Version) {
    usage.push(...collect(await Version.find(match).select('workflowId name nodes version').lean(), (v) => ({ version: v.version })));
  }
  return usage;
}

/**
 * Save-time validation (spec/25 API): every node's connectionId must be null,
 * 'sandbox', or a connection in this workspace for the node's integration.
 * Throws HttpError(400) naming the first offending node. Callers: workflow PUT,
 * collaboration ops (spec/28).
 */
export async function validateNodeConnections(workspaceId, nodes = []) {
  const refs = nodes
    .map((n) => ({ node: n, id: nodeConnectionId(n) }))
    .filter(({ id }) => id !== null && id !== undefined && id !== '' && id !== SANDBOX_CONNECTION_ID);
  if (!refs.length) return;

  const ids = [...new Set(refs.map((r) => String(r.id)))].filter((id) => mongoose.Types.ObjectId.isValid(id));
  const docs = ids.length ? await Connection.find({ _id: { $in: ids }, workspaceId }).select('integration').lean() : [];
  const byId = new Map(docs.map((d) => [d._id.toString(), d]));

  for (const { node, id } of refs) {
    const doc = byId.get(String(id));
    const integration = node?.data?.config?.integration;
    if (!doc || (integration && doc.integration !== integration)) {
      const label = node?.data?.config?.label || node?.data?.label || node?.id;
      throw new HttpError(400, `Unknown connection for node "${label}"`);
    }
  }
}

/** Templates don't carry connections (spec/25): null every connectionId. */
export function stripConnectionIds(nodes = []) {
  return nodes.map((n) => {
    if (!n?.data?.config || !('connectionId' in n.data.config)) return n;
    return { ...n, data: { ...n.data, config: { ...n.data.config, connectionId: null } } };
  });
}

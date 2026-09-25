import mongoose from 'mongoose';
import SandboxRecord from '../models/SandboxRecord.js';
import { PermanentFailure } from '../queue/errors.js';

/**
 * `ctx.sandbox` — a per-(workspace, integration) document store for stateful
 * sandbox actions (spec/27 §3), backed by SandboxRecord.
 *
 * Collections are namespaced `<integration>.<name>` and every query carries the
 * workspace, so one tenant's sandbox can never see another's. Callers pass the
 * short name (`issues`); this file adds the prefix.
 *
 * Internal bookkeeping lives in `<integration>._seeded` and
 * `<integration>._counters` — prefixed with `_` so browsing can hide them.
 */

const SEEDED = '_seeded';
const COUNTERS = '_counters';

/**
 * Equality-only on top-level fields. `$` keys and dotted paths are rejected, and
 * so are non-primitive values: `{ status: { $ne: null } }` has a clean key but an
 * operator value, and would otherwise slip through as a Mongo query operator.
 */
function assertPlainFilter(obj) {
  if (obj === undefined || obj === null) return {};
  if (typeof obj !== 'object' || Array.isArray(obj)) throw new PermanentFailure('Filter must be a JSON object');
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$') || key.includes('.')) {
      throw new PermanentFailure(`Filter key "${key}" is not allowed (no operators or dotted paths)`);
    }
    if (value !== null && typeof value === 'object') {
      throw new PermanentFailure(`Filter value for "${key}" must be a plain value (string, number, boolean or null)`);
    }
  }
  return obj;
}

function assertPlainPatch(obj) {
  if (obj === undefined || obj === null) return {};
  if (typeof obj !== 'object' || Array.isArray(obj)) throw new PermanentFailure('Patch must be a JSON object');
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) {
      throw new PermanentFailure(`Patch key "${key}" is not allowed (no operators or dotted paths)`);
    }
  }
  return obj;
}

const prefixed = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [`doc.${k}`, v]));

/**
 * The record's own id is `recordId`. `id` defaults to it, but a document that
 * carries its own `id` (a Stripe `cus_…`) keeps it — that's what the provider's
 * real API would return.
 */
function toDoc(record) {
  const recordId = record._id.toString();
  return { id: recordId, ...(record.doc || {}), recordId, createdAt: record.createdAt, updatedAt: record.updatedAt };
}

// First-touch seeding is remembered in-process as well as in the database, so a
// busy collection doesn't pay a marker lookup on every read.
const seededCache = new Set();

// Marker and counter documents have no unique index, so two concurrent upserts
// could both insert. Everything runs in one process (CLAUDE.md), so serialising
// per key in memory is enough to make first-touch seeding and numbering exact
// when a fan-out hits the same collection from several nodes at once.
const chains = new Map();
function serial(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(key, next);
  next.finally(() => { if (chains.get(key) === next) chains.delete(key); }).catch(() => {});
  return next;
}

export function createSandboxStore({ workspaceId, integration, runId = null }) {
  const ns = (collection) => {
    // Checked on use, not construction: actions that never touch the store
    // (builtin demo tools) shouldn't care whether a workspace was supplied.
    if (!workspaceId || !mongoose.isValidObjectId(workspaceId)) {
      throw new PermanentFailure('The sandbox store needs a workspace');
    }
    if (!collection || typeof collection !== 'string') throw new PermanentFailure('A collection name is required');
    return `${integration}.${collection}`;
  };
  const base = (collection) => ({ workspaceId, collectionName: ns(collection) });
  const byId = (collection, id) => {
    if (!mongoose.isValidObjectId(id)) throw new PermanentFailure(`No record "${id}" in ${collection}`);
    return { ...base(collection), _id: id };
  };
  const cacheKey = (key) => `${workspaceId}|${integration}|${key}`;
  const record = (collection, doc) => ({
    ...base(collection),
    integration,
    runId: mongoose.isValidObjectId(runId) ? runId : null,
    doc,
  });

  const store = {
    workspaceId,
    integration,

    async insert(collection, doc = {}) {
      const created = await SandboxRecord.create(record(collection, doc));
      return toDoc(created);
    },

    async find(collection, filter = {}, { limit = 50, sort = { createdAt: -1 } } = {}) {
      const query = { ...base(collection), ...prefixed(assertPlainFilter(filter)) };
      const capped = Math.max(1, Math.min(200, Number(limit) || 50));
      const records = await SandboxRecord.find(query).sort({ ...sort, _id: sort.createdAt ?? -1 }).limit(capped).lean();
      return records.map(toDoc);
    },

    async findOne(collection, filter = {}) {
      const [first] = await store.find(collection, filter, { limit: 1 });
      return first || null;
    },

    async get(collection, id) {
      const found = await SandboxRecord.findOne(byId(collection, id)).lean();
      return found ? toDoc(found) : null;
    },

    async update(collection, id, patch = {}) {
      const updated = await SandboxRecord.findOneAndUpdate(
        byId(collection, id),
        { $set: prefixed(assertPlainPatch(patch)) },
        { returnDocument: 'after' },
      ).lean();
      if (!updated) throw new PermanentFailure(`No record "${id}" in ${collection}`);
      return toDoc(updated);
    },

    async remove(collection, id) {
      const result = await SandboxRecord.deleteOne(byId(collection, id));
      return result.deletedCount > 0;
    },

    count(collection, filter = {}) {
      return SandboxRecord.countDocuments({ ...base(collection), ...prefixed(assertPlainFilter(filter)) });
    },

    /** Seeds an empty collection once, so reads are never empty on a fresh workspace. */
    async seed(collection, docs = []) {
      if (await store.count(collection)) return 0;
      await SandboxRecord.insertMany(docs.map((doc) => record(collection, doc)));
      return docs.length;
    },

    /**
     * First-touch fixtures keyed by something finer than the collection — e.g.
     * one set of issues per GitHub repo. The marker survives the fixtures being
     * deleted, so "Reset sandbox" is the only way to get them back.
     * `docs` may be a function, evaluated only when seeding actually happens.
     */
    async seedOnce(key, collection, docs = []) {
      if (seededCache.has(cacheKey(key))) return 0;
      return serial(`seed:${cacheKey(key)}`, async () => {
        if (seededCache.has(cacheKey(key))) return 0; // seeded while we queued
        const marker = await SandboxRecord.findOneAndUpdate(
          { ...base(SEEDED), 'doc.key': key },
          { $setOnInsert: { integration, runId: null } },
          { upsert: true, returnDocument: 'before' },
        ).lean();
        if (marker) {
          seededCache.add(cacheKey(key));
          return 0; // an earlier call (or an earlier boot) already seeded
        }
        const list = typeof docs === 'function' ? await docs() : docs;
        if (list.length) await SandboxRecord.insertMany(list.map((doc) => record(collection, doc)));
        seededCache.add(cacheKey(key));
        return list.length;
      });
    },

    /**
     * Per-name incrementing numbers that look real (`#4`, `WEB-12`). `after`
     * makes the first number follow whatever fixtures already used.
     */
    async nextNumber(name, { after = 0 } = {}) {
      return serial(`count:${cacheKey(name)}`, async () => {
        const filter = { ...base(COUNTERS), 'doc.name': name };
        await SandboxRecord.updateOne(
          filter,
          { $setOnInsert: { integration, runId: null }, $max: { 'doc.value': after } },
          { upsert: true },
        );
        const counter = await SandboxRecord.findOneAndUpdate(filter, { $inc: { 'doc.value': 1 } }, { returnDocument: 'after' }).lean();
        return counter.doc.value;
      });
    },

    /** For the Sandbox data tab: every user-visible collection and its size. */
    async collections() {
      ns('_'); // workspace guard
      const prefix = `${integration}.`;
      const rows = await SandboxRecord.aggregate([
        { $match: { workspaceId: new mongoose.Types.ObjectId(String(workspaceId)), integration } },
        { $group: { _id: '$collectionName', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]);
      return rows
        .map((r) => ({ name: r._id.startsWith(prefix) ? r._id.slice(prefix.length) : r._id, count: r.count }))
        .filter((c) => !c.name.startsWith('_'));
    },

    /** "Reset sandbox": everything this integration stored in this workspace, markers included. */
    async reset() {
      ns('_'); // workspace guard
      const result = await SandboxRecord.deleteMany({ workspaceId, integration });
      const prefix = cacheKey('');
      for (const key of seededCache) if (key.startsWith(prefix)) seededCache.delete(key);
      return result.deletedCount;
    },
  };
  return store;
}

/** Test hook: forget in-process seeding markers (the DB markers are the truth). */
export function clearSeedCache() {
  seededCache.clear();
}

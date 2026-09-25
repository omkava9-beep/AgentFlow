import mongoose from 'mongoose';
import Workflow from '../models/Workflow.js';
import Workspace from '../models/Workspace.js';
import Connection from '../models/Connection.js';
import Run from '../models/Run.js';
import User from '../models/User.js';
import { env } from '../config/env.js';
import { integrationsConfig } from '../config/integrations.js';
import { queue } from '../queue/index.js';
import { SYSTEM_KEY } from '../queue/InProcessQueue.js';
import { toolCache } from '../cache/TTLCache.js';
import { listSchedules, activeScheduleCount } from '../scheduler/index.js';
import { rssPollState } from '../scheduler/rssPoller.js';
import { hub } from '../collab/hub.js';
import { mcpPool } from '../mcp/McpPool.js';
import { getIo } from '../sockets/ioInstance.js';
import { getUsage, utcDay } from '../services/usage.js';
import { scopedFilter } from '../tenancy/scoped.js';

/**
 * spec/36 §7. The queue, cache, cron registry and sockets are shared by every
 * tenant, so the member-facing page reports only this workspace's slice of each.
 * The cross-tenant totals live behind OPERATOR_EMAILS, never a workspace role.
 */

const startedAt = Date.now();

async function mongoHealth() {
  const up = mongoose.connection.readyState === 1;
  if (!up) return { status: 'down', pingMs: null };
  const t0 = Date.now();
  try {
    await mongoose.connection.db.admin().ping();
    return { status: 'up', pingMs: Date.now() - t0 };
  } catch {
    return { status: 'degraded', pingMs: null };
  }
}

function ioOrNull() {
  try { return getIo(); } catch { return null; }
}

/** Cache keys are stable JSON that include the workspace id (spec/22, spec/25 §5). */
function cacheEntriesFor(workspaceId) {
  const needle = `"workspaceId":"${workspaceId}"`;
  let entries = 0;
  const now = Date.now();
  for (const [key, entry] of toolCache.store) {
    if (entry.expiresAt > now && key.includes(needle)) entries += 1;
  }
  return entries;
}

function liveCacheSize() {
  const now = Date.now();
  let size = 0;
  for (const entry of toolCache.store.values()) if (entry.expiresAt > now) size += 1;
  return size;
}

function mcpState(connectionId) {
  const d = mcpPool.describe(connectionId);
  if (!d) return { state: 'idle' };
  if (d.backoffUntil && d.backoffUntil > Date.now()) return { state: 'error', failures: d.failures, retryAt: new Date(d.backoffUntil).toISOString() };
  return { state: d.connected ? 'connected' : 'idle', failures: d.failures };
}

export async function workspaceStatus(req, res, next) {
  try {
    const workspaceId = String(req.workspaceId);
    const [mongo, workflows, mcpConnections, rssConnections, activeRuns, usage] = await Promise.all([
      mongoHealth(),
      Workflow.find(scopedFilter(req)).select('_id name').lean(),
      Connection.find(scopedFilter(req, { integration: 'mcp' })).select('_id name config.transport').lean(),
      Connection.find(scopedFilter(req, { integration: 'rss' })).select('_id name').lean(),
      Run.aggregate([
        { $match: { workspaceId: new mongoose.Types.ObjectId(workspaceId), status: { $in: ['pending', 'running', 'waiting'] } } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      getUsage(workspaceId, { days: 1 }),
    ]);

    const nameOf = new Map(workflows.map((w) => [String(w._id), w.name]));
    const schedules = listSchedules()
      .filter((s) => nameOf.has(String(s.workflowId)))
      .map((s) => ({ workflowId: String(s.workflowId), name: nameOf.get(String(s.workflowId)), nextRun: s.nextRun }));

    const today = usage.find((d) => d.day === utcDay()) || null;
    const hits = today?.cacheHits || 0;
    const misses = today?.cacheMisses || 0;

    const io = ioOrNull();
    let sockets = 0;
    let online = [];
    if (io) {
      const inRoom = await io.in(`workspace:${workspaceId}`).fetchSockets();
      sockets = inRoom.length;
      const ids = [...new Set(inRoom.map((s) => s.data?.userId).filter(Boolean).map(String))];
      const users = await User.find({ _id: { $in: ids } }).select('name email').lean();
      online = users.map((u) => ({ id: String(u._id), name: u.name || u.email }));
    }

    const collab = [...hub.sessions.values()]
      .filter((s) => s.workspaceId === workspaceId)
      .map((s) => ({ workflowId: s.workflowId, name: nameOf.get(s.workflowId) || s.doc?.name || 'Workflow', editors: s.peers.size, seq: s.seq }));

    const rss = rssPollState();
    const runsByStatus = Object.fromEntries(activeRuns.map((r) => [r._id, r.n]));

    res.json({
      generatedAt: new Date().toISOString(),
      api: { status: 'up', uptimeSec: Math.round((Date.now() - startedAt) / 1000) },
      mongo,
      modes: { integrationsLive: integrationsConfig.live, agentProvider: env.agentProvider },
      queue: queue.statsFor(workspaceId),
      runs: { pending: runsByStatus.pending || 0, running: runsByStatus.running || 0, waiting: runsByStatus.waiting || 0 },
      cache: { entries: cacheEntriesFor(workspaceId), hitsToday: hits, missesToday: misses, hitRate: hits + misses ? hits / (hits + misses) : null },
      cron: { schedules },
      rss: {
        pollerRunning: rss.running,
        connections: rssConnections.map((c) => ({ id: String(c._id), name: c.name, lastPolledAt: rss.lastPolled[String(c._id)] || null })),
      },
      realtime: { sockets, online, collabSessions: collab },
      mcp: mcpConnections.map((c) => ({ id: String(c._id), name: c.name, transport: c.config?.transport || null, ...mcpState(c._id) })),
    });
  } catch (err) {
    next(err);
  }
}

/** Is the signed-in user an operator? Used by /auth/me and the global route. */
export async function isOperator(userId) {
  if (!env.operatorEmails.length || !userId) return false;
  const user = await User.findById(userId).select('email').lean();
  return Boolean(user && env.operatorEmails.includes(String(user.email).toLowerCase()));
}

export async function globalStatus(req, res, next) {
  try {
    // 404, not 403: the route shouldn't advertise itself (spec/36 API).
    if (!(await isOperator(req.userId))) return res.status(404).json({ error: 'Not found' });

    const pool = queue.stats();
    const keys = new Set([...queue.activeByKey.keys(), ...queue.subqueues.keys()]);
    const wsIds = [...keys].filter((k) => k !== SYSTEM_KEY && mongoose.isValidObjectId(k));
    const workspaces = await Workspace.find({ _id: { $in: wsIds } }).select('name slug plan').lean(); // tenancy: capability lookup (operator view)
    const byId = new Map(workspaces.map((w) => [String(w._id), w]));
    const perWorkspace = [...keys].map((key) => {
      const s = queue.statsFor(key);
      const ws = byId.get(key);
      return { workspaceId: key, name: key === SYSTEM_KEY ? 'System' : ws?.name || '(deleted workspace)', plan: ws?.plan || null, active: s.active, queued: s.queued, cap: s.cap };
    }).sort((a, b) => (b.active + b.queued) - (a.active + a.queued));

    const io = ioOrNull();
    const mem = process.memoryUsage();
    res.json({
      generatedAt: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      memory: { rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576) },
      mongo: await mongoHealth(),
      queue: { ...pool, poolSaturated: pool.active >= pool.concurrency, perWorkspace },
      cache: { entries: liveCacheSize() },
      cron: { schedules: activeScheduleCount() },
      rss: rssPollState(),
      realtime: { sockets: io ? io.engine.clientsCount : 0, collabSessions: hub.sessions.size },
      mcp: { pooledClients: mcpPool.entries.size },
    });
  } catch (err) {
    next(err);
  }
}

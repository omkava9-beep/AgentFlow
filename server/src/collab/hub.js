import { randomUUID } from 'node:crypto';
import Workflow from '../models/Workflow.js';
import Membership from '../models/Membership.js';
import User from '../models/User.js';
import { env } from '../config/env.js';
import { permissionsFor } from '../tenancy/permissions.js';
import { getIo } from '../sockets/ioInstance.js';
import { validateNodeConnections } from '../services/connectionService.js';
import { normalizeNode } from '../integrations/normalizeToolConfig.js';
import { applyOp, assertOpShape, docFromWorkflow, docToPlain, nodesNeedingConnectionCheck, OpRejected } from './ops.js';

/**
 * The collaboration hub (spec/28 §1): an in-process singleton, like the queue
 * and the cache. One session per workflow that someone has open. The session
 * holds the authoritative draft; every edit is an op that the hub validates,
 * numbers with a sequence, applies, broadcasts, and flushes to MongoDB on a
 * debounce.
 *
 * Ordering: every mutation of a session goes through `session.chain`, a promise
 * chain, so ops are applied strictly in arrival order even though some need an
 * async check (connection ownership) before they're applied. Node's single
 * thread plus that chain is the whole concurrency story - no locks, no OT.
 */

const OP_LOG_SIZE = 500;
const SESSION_GRACE_MS = 30_000;
const PALETTE = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16'];

const room = (workflowId) => `workflow:${workflowId}`;

function io() {
  try {
    return getIo();
  } catch {
    return null; // scripts / check context: nothing to broadcast to
  }
}

/** Deterministic per user, so someone keeps their color across tabs and reloads. */
export function colorFor(userId) {
  let hash = 0;
  for (const ch of String(userId)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

const publicPeer = (p) => ({ socketId: p.socketId, userId: p.userId, name: p.name, color: p.color, role: p.role, away: p.away });
const publicLock = (nodeId, l) => ({ nodeId, userId: l.userId, name: l.name, socketId: l.socketId });

function lockTtl() {
  return env.collabLockTtlMs;
}

function lockExpired(lock) {
  return Date.now() - lock.heartbeatAt > lockTtl();
}

class CollabHub {
  constructor() {
    this.sessions = new Map();
    this.loading = new Map();
    this.deletedHooks = [];
    this.restoredHooks = [];
    this.changedHooks = [];
    this.sweeper = null;
  }

  // ------------------------------------------------------------------ hooks (spec/29)

  /** `fn(workflowId, nodeId, lastKnownNode)` after a node is removed by an op or a replace. */
  onNodeDeleted(fn) {
    this.deletedHooks.push(fn);
  }

  /** `fn(workflowId, nodeId, node)` when a node id deleted earlier in the session comes back (undo). */
  onNodeRestored(fn) {
    this.restoredHooks.push(fn);
  }

  /**
   * `fn(workflowId)` after the draft changes (an op or a replace). spec/30 uses
   * it to keep `hasUnpublishedChanges` current; read the draft with getDraft().
   */
  onDraftChanged(fn) {
    this.changedHooks.push(fn);
  }

  #fire(hooks, ...args) {
    for (const fn of hooks) {
      Promise.resolve()
        .then(() => fn(...args))
        .catch((err) => console.error('[collab] hook failed:', err));
    }
  }

  // ------------------------------------------------------------------ sessions

  /** The live draft for REST readers, or null when nobody has the workflow open. */
  getDraft(workflowId) {
    const session = this.sessions.get(String(workflowId));
    if (!session) return null;
    return { ...docToPlain(session.doc), draftSeq: session.seq, sessionId: session.sessionId };
  }

  hasSession(workflowId) {
    return this.sessions.has(String(workflowId));
  }

  async #ensureSession(workflowId) {
    const id = String(workflowId);
    if (this.sessions.has(id)) return this.sessions.get(id);
    if (this.loading.has(id)) return this.loading.get(id);

    const promise = (async () => {
      // The caller has already authorized the room (spec/24) - this only loads.
      const workflow = await Workflow.findById(id).lean(); // tenancy: capability lookup (room authorized by caller)
      if (!workflow) return null;
      const session = {
        workflowId: id,
        workspaceId: String(workflow.workspaceId),
        sessionId: randomUUID(),
        seq: workflow.draftSeq || 0,
        doc: docFromWorkflow(workflow),
        opLog: [],
        opIds: new Map(),
        peers: new Map(),
        locks: new Map(),
        deletedIds: new Set(),
        chain: Promise.resolve(),
        dirty: false,
        dirtySince: null,
        updatedBy: null,
        flushTimer: null,
        flushing: Promise.resolve(),
        dropTimer: null,
      };
      this.sessions.set(id, session);
      this.#startSweeper();
      return session;
    })();

    this.loading.set(id, promise);
    try {
      return await promise;
    } finally {
      this.loading.delete(id);
    }
  }

  /** Every session mutation is queued here so ops apply in arrival order. */
  #enqueue(session, fn) {
    const next = session.chain.then(fn, fn);
    session.chain = next.catch(() => {});
    return next;
  }

  #scheduleDrop(session) {
    clearTimeout(session.dropTimer);
    session.dropTimer = setTimeout(async () => {
      if (session.peers.size) return;
      await this.#flush(session);
      if (!session.peers.size && this.sessions.get(session.workflowId) === session) {
        clearTimeout(session.flushTimer);
        this.sessions.delete(session.workflowId);
      }
    }, SESSION_GRACE_MS);
    session.dropTimer.unref?.();
  }

  // ------------------------------------------------------------------ flushing

  #markDirty(session, userId) {
    this.#fire(this.changedHooks, session.workflowId);
    session.dirty = true;
    if (userId) session.updatedBy = userId;
    const now = Date.now();
    if (!session.dirtySince) session.dirtySince = now;
    clearTimeout(session.flushTimer);
    // Debounced after the last op, but never later than the hard ceiling from
    // the first unflushed op - a continuous editing burst still persists.
    const wait = Math.max(0, Math.min(env.collabFlushDebounceMs, env.collabFlushMaxMs - (now - session.dirtySince)));
    session.flushTimer = setTimeout(() => this.#flush(session), wait);
    session.flushTimer.unref?.();
  }

  #flush(session) {
    session.flushing = session.flushing.then(async () => {
      if (!session.dirty) return;
      clearTimeout(session.flushTimer);
      session.dirty = false;
      session.dirtySince = null;
      const { name, nodes, edges } = docToPlain(session.doc);
      const set = { name, nodes, edges, draftSeq: session.seq };
      if (session.updatedBy) set.updatedBy = session.updatedBy;
      try {
        // Workspace-scoped write (spec/22), and only the draft fields: triggers,
        // share tokens and everything else keep their own endpoints.
        await Workflow.updateOne({ _id: session.workflowId, workspaceId: session.workspaceId }, { $set: set });
      } catch (err) {
        console.error(`[collab] flush of ${session.workflowId} failed:`, err.message);
        this.#markDirty(session);
      }
    });
    return session.flushing;
  }

  /**
   * Before anything reads the draft for real work (a run, a publish, a template
   * snapshot): let queued ops land, then write. Resolves immediately when no
   * session is live.
   */
  async flushBeforeRead(workflowId) {
    const session = this.sessions.get(String(workflowId));
    if (!session) return;
    await session.chain;
    await this.#flush(session);
  }

  /** Best-effort flush of every session, for SIGINT/SIGTERM. */
  async flushAll() {
    await Promise.all([...this.sessions.values()].map((s) => s.chain.then(() => this.#flush(s)).catch(() => {})));
  }

  // ------------------------------------------------------------------ joining

  /**
   * `workflow:subscribe` (spec/28 §7). The room was authorized by the caller.
   * Everything after the async loads runs synchronously: the socket joins the
   * room and the snapshot is taken in one tick, so no op can fall in between.
   */
  async join(socket, workflowId, { workspaceId, sinceSeq, sessionId } = {}) {
    const userId = socket.data.userId;
    const [user, membership] = await Promise.all([
      User.findById(userId).select('name email').lean(),
      Membership.findOne({ workspaceId, userId }).select('role').lean(),
    ]);
    if (!membership) return { ok: false, error: 'not_found' };
    const session = await this.#ensureSession(workflowId);
    if (!session || session.workspaceId !== String(workspaceId)) return { ok: false, error: 'not_found' };

    // ---- synchronous from here on
    const roomName = room(session.workflowId);
    socket.join(roomName);
    socket.data.rooms?.set(roomName, session.workspaceId);
    clearTimeout(session.dropTimer);

    const peer = {
      socketId: socket.id,
      userId,
      name: user?.name || user?.email || 'Someone',
      color: colorFor(userId),
      role: membership.role,
      permissions: new Set(permissionsFor(membership.role)),
      away: false,
    };
    const isRejoin = session.peers.has(socket.id);
    session.peers.set(socket.id, peer);
    if (!isRejoin) socket.to(roomName).emit('presence:join', { workflowId: session.workflowId, ...publicPeer(peer) });

    const you = { socketId: socket.id, userId, color: peer.color, role: peer.role };
    const catchUp = this.#catchUp(session, sessionId, sinceSeq);
    if (catchUp) return { ok: true, you, catchUp };
    return { ok: true, you, snapshot: this.#snapshot(session, sessionId && sessionId !== session.sessionId ? 'server_restarted' : undefined) };
  }

  #catchUp(session, sessionId, sinceSeq) {
    if (!sessionId || sessionId !== session.sessionId || !Number.isInteger(sinceSeq) || sinceSeq > session.seq) return null;
    if (sinceSeq === session.seq) return { sessionId: session.sessionId, seq: session.seq, ops: [] };
    const oldest = session.opLog[0]?.seq;
    if (oldest === undefined || sinceSeq < oldest - 1) return null;
    const ops = session.opLog.filter((e) => e.seq > sinceSeq).map(({ seq, op, by, cascade }) => ({ seq, op, by, ...(cascade && { cascade }) }));
    return { sessionId: session.sessionId, seq: session.seq, ops };
  }

  #snapshot(session, reason) {
    const plain = docToPlain(session.doc);
    const locks = [...session.locks]
      .filter(([, l]) => !lockExpired(l))
      .map(([nodeId, l]) => publicLock(nodeId, l));
    return {
      sessionId: session.sessionId,
      seq: session.seq,
      name: plain.name,
      nodes: plain.nodes,
      edges: plain.edges,
      peers: [...session.peers.values()].map(publicPeer),
      locks,
      ...(reason && { reason }),
    };
  }

  #removePeer(session, socketId, { leaveRoom = null } = {}) {
    const peer = session.peers.get(socketId);
    if (!peer) return;
    session.peers.delete(socketId);
    for (const [nodeId, lock] of session.locks) {
      if (lock.socketId === socketId) this.#releaseLock(session, nodeId);
    }
    if (leaveRoom) {
      leaveRoom.leave(room(session.workflowId));
      leaveRoom.data.rooms?.delete(room(session.workflowId));
    }
    io()?.to(room(session.workflowId)).emit('presence:leave', { workflowId: session.workflowId, socketId, userId: peer.userId });
    if (!session.peers.size) {
      // The last one out writes the draft (spec/28 §1), then the session lingers
      // for a grace period so a page reload doesn't go back to the database.
      this.#flush(session);
      this.#scheduleDrop(session);
    }
  }

  leave(socket, workflowId) {
    const session = this.sessions.get(String(workflowId));
    if (session) this.#removePeer(session, socket.id, { leaveRoom: socket });
  }

  disconnect(socket) {
    for (const session of this.sessions.values()) {
      if (session.peers.has(socket.id)) this.#removePeer(session, socket.id);
    }
  }

  // ------------------------------------------------------------------ ops

  /**
   * `collab:op`. Resolves the ack: `{ ok: true, seq }` or
   * `{ ok: false, reason, message?, heldBy? }`.
   */
  submitOp(socket, workflowId, op) {
    const session = this.sessions.get(String(workflowId));
    const peer = session?.peers.get(socket.id);
    // Ops are only accepted from room members (spec/28 edge cases).
    if (!session || !peer) return Promise.resolve({ ok: false, reason: 'forbidden', message: 'Not subscribed to this workflow' });

    return this.#enqueue(session, async () => {
      if (!peer.permissions.has('workflow:edit')) return { ok: false, reason: 'forbidden', message: "You can't edit this workflow" };

      // A resent op (reconnect) is acked with its original seq, not reapplied.
      if (op?.opId && session.opIds.has(op.opId)) return { ok: true, seq: session.opIds.get(op.opId), duplicate: true };

      try {
        assertOpShape(op);
        await this.#checkConnections(session, op);
        const effects = applyOp(session.doc, op, {
          permissions: peer.permissions,
          deletedIds: session.deletedIds,
          lockedByOther: (nodeId) => {
            const lock = session.locks.get(nodeId);
            return lock && lock.socketId !== socket.id && !lockExpired(lock) ? lock : null;
          },
        });
        return this.#commit(session, op, effects, { userId: peer.userId, socketId: socket.id }, socket);
      } catch (err) {
        if (err instanceof OpRejected) return { ok: false, reason: err.reason, message: err.message, ...err.extra };
        console.error('[collab] op failed:', err);
        return { ok: false, reason: 'invalid', message: 'The server could not apply that change' };
      }
    });
  }

  /** Nodes may only point at this workspace's connections, for their own integration (spec/25). */
  async #checkConnections(session, op) {
    for (const item of nodesNeedingConnectionCheck(op, session.doc)) {
      let node;
      if (item.kind === 'add') {
        node = normalizeNode(structuredClone(item.node));
      } else {
        node = structuredClone(item.node);
        node.data ||= {};
        node.data.config ||= {};
        let cursor = node.data.config;
        for (const seg of item.path.slice(0, -1)) cursor = (cursor[seg] ||= {});
        cursor[item.path[item.path.length - 1]] = item.value;
      }
      try {
        await validateNodeConnections(session.workspaceId, [node]);
      } catch (err) {
        throw new OpRejected('invalid', err.message);
      }
    }
  }

  #commit(session, op, effects, by, socket) {
    const seq = ++session.seq;
    const cascade = effects.cascade.edgeIds.length ? effects.cascade : undefined;
    const entry = { seq, opId: op.opId || null, op, by, cascade };
    session.opLog.push(entry);
    if (op.opId) session.opIds.set(op.opId, seq);
    while (session.opLog.length > OP_LOG_SIZE) {
      const dropped = session.opLog.shift();
      if (dropped.opId) session.opIds.delete(dropped.opId);
    }

    for (const { nodeId } of effects.deleted) {
      session.deletedIds.add(nodeId);
      if (session.locks.has(nodeId)) this.#releaseLock(session, nodeId);
    }
    // Any op from the lock holder on its node counts as a heartbeat.
    const touched = op.type === 'batch' ? op.ops.map((o) => o.nodeId).filter(Boolean) : [op.nodeId].filter(Boolean);
    for (const nodeId of touched) {
      const lock = session.locks.get(nodeId);
      if (lock && lock.socketId === by.socketId) lock.heartbeatAt = Date.now();
    }

    this.#markDirty(session, by.userId);
    const payload = { workflowId: session.workflowId, seq, op, by, ...(cascade && { cascade }) };
    if (socket) socket.to(room(session.workflowId)).emit('collab:op', payload);
    else io()?.to(room(session.workflowId)).emit('collab:op', payload);

    for (const { nodeId, lastKnownNode } of effects.deleted) this.#fire(this.deletedHooks, session.workflowId, nodeId, lastKnownNode);
    for (const nodeId of effects.restored) this.#fire(this.restoredHooks, session.workflowId, nodeId, session.doc.nodes.get(nodeId));

    return { ok: true, seq, ...(cascade && { cascade }) };
  }

  // ------------------------------------------------------------------ REST writers

  /**
   * Full-document replace (spec/28 §8): the PUT route and spec/30's restore.
   * The caller has already normalized and validated the graph. With a live
   * session the replace is sequenced like an op, flushed, and broadcast as a
   * snapshot; without one it's a direct write that bumps `draftSeq`.
   *
   * Returns the new `draftSeq`.
   */
  async replace(workflow, { name, nodes, edges }, { by = null, reason = 'replaced', extra = null } = {}) {
    const workflowId = String(workflow._id);
    const session = this.sessions.get(workflowId);
    const previousIds = new Set((session ? [...session.doc.nodes.keys()] : (workflow.nodes || []).map((n) => n.id)));

    if (!session) {
      const set = {};
      if (name !== undefined) set.name = name;
      if (nodes !== undefined) set.nodes = nodes;
      if (edges !== undefined) set.edges = edges;
      if (by?.userId) set.updatedBy = by.userId;
      const updated = await Workflow.findOneAndUpdate(
        { _id: workflowId, workspaceId: workflow.workspaceId },
        { $set: set, $inc: { draftSeq: 1 } },
        { new: true },
      ).select('draftSeq nodes').lean();
      this.#fireReplaceHooks(workflowId, previousIds, nodes, workflow.nodes);
      this.#fire(this.changedHooks, workflowId);
      return updated?.draftSeq ?? null;
    }

    return this.#enqueue(session, async () => {
      const before = docToPlain(session.doc);
      const next = docFromWorkflow({
        name: name !== undefined ? name : before.name,
        nodes: nodes !== undefined ? nodes : before.nodes,
        edges: edges !== undefined ? edges : before.edges,
      });
      session.doc = next;
      session.seq += 1;
      // Inverses and catch-up computed against the old document mean nothing
      // now: clearing the log forces reconnecting clients onto the snapshot.
      session.opLog = [];
      session.opIds.clear();
      // Locks survive for nodes that still exist; the snapshot carries them.
      for (const nodeId of [...session.locks.keys()]) {
        if (!next.nodes.has(nodeId)) session.locks.delete(nodeId);
      }
      this.#markDirty(session, by?.userId);
      await this.#flush(session);
      io()?.to(room(workflowId)).emit('collab:snapshot', {
        workflowId,
        ...this.#snapshot(session, reason),
        ...(by && { by }),
        // e.g. spec/30's `{ version }` on a restore.
        ...(extra || {}),
      });
      this.#fireReplaceHooks(workflowId, previousIds, nodes, before.nodes);
      if (!session.peers.size) this.#scheduleDrop(session);
      return session.seq;
    });
  }

  #fireReplaceHooks(workflowId, previousIds, nextNodes, previousNodes) {
    if (nextNodes === undefined) return;
    const nextIds = new Set(nextNodes.map((n) => n.id));
    const previousById = new Map((previousNodes || []).map((n) => [n.id, n]));
    for (const id of previousIds) {
      if (!nextIds.has(id)) this.#fire(this.deletedHooks, workflowId, id, previousById.get(id) || null);
    }
    for (const node of nextNodes) {
      if (!previousIds.has(node.id)) this.#fire(this.restoredHooks, workflowId, node.id, node);
    }
  }

  /** Workflow deleted: tell everyone, drop the session without flushing. */
  close(workflowId, { by = null, reason = 'deleted' } = {}) {
    const id = String(workflowId);
    const session = this.sessions.get(id);
    const server = io();
    server?.to(room(id)).emit('collab:closed', { workflowId: id, reason, by });
    server?.in(room(id)).socketsLeave(room(id));
    if (!session) return;
    clearTimeout(session.flushTimer);
    clearTimeout(session.dropTimer);
    session.dirty = false;
    this.sessions.delete(id);
  }

  // ------------------------------------------------------------------ locks

  lock(socket, workflowId, nodeId) {
    const session = this.sessions.get(String(workflowId));
    const peer = session?.peers.get(socket.id);
    if (!session || !peer || !peer.permissions.has('workflow:edit')) return { ok: false, reason: 'forbidden' };
    if (!session.doc.nodes.has(nodeId)) return { ok: false, reason: 'not_found' };

    const held = session.locks.get(nodeId);
    if (held && held.socketId !== socket.id && !lockExpired(held)) {
      return { ok: false, heldBy: { userId: held.userId, name: held.name, sameUser: held.userId === peer.userId } };
    }
    const isNew = !held || held.socketId !== socket.id;
    session.locks.set(nodeId, { userId: peer.userId, socketId: socket.id, name: peer.name, heartbeatAt: Date.now() });
    if (isNew) {
      io()?.to(room(session.workflowId)).emit('collab:locked', {
        workflowId: session.workflowId,
        nodeId,
        by: { userId: peer.userId, name: peer.name, socketId: socket.id },
      });
    }
    return { ok: true };
  }

  unlock(socket, workflowId, nodeId) {
    const session = this.sessions.get(String(workflowId));
    const held = session?.locks.get(nodeId);
    if (held && held.socketId === socket.id) this.#releaseLock(session, nodeId);
    return { ok: true };
  }

  heartbeat(socket, workflowId, nodeId) {
    const held = this.sessions.get(String(workflowId))?.locks.get(nodeId);
    if (!held || held.socketId !== socket.id) return { ok: false };
    held.heartbeatAt = Date.now();
    return { ok: true };
  }

  #releaseLock(session, nodeId, reason) {
    if (!session.locks.delete(nodeId)) return;
    io()?.to(room(session.workflowId)).emit('collab:unlocked', { workflowId: session.workflowId, nodeId, ...(reason && { reason }) });
  }

  #startSweeper() {
    if (this.sweeper) return;
    const every = Math.max(250, Math.min(lockTtl() / 4, 5000));
    this.sweeper = setInterval(() => {
      for (const session of this.sessions.values()) {
        for (const [nodeId, lock] of session.locks) {
          if (lockExpired(lock)) this.#releaseLock(session, nodeId, 'expired');
        }
      }
    }, every);
    this.sweeper.unref?.();
  }

  // ------------------------------------------------------------------ presence

  /** Relays an ephemeral presence event to the other peers (spec/28 §4). */
  presence(socket, event, payload = {}) {
    const session = this.sessions.get(String(payload.workflowId));
    const peer = session?.peers.get(socket.id);
    if (!session || !peer) return;
    let data;
    if (event === 'presence:cursor') {
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
      data = { x: payload.x, y: payload.y };
    } else if (event === 'presence:select') {
      data = { nodeIds: (payload.nodeIds || []).slice(0, 200).map(String), edgeIds: (payload.edgeIds || []).slice(0, 200).map(String) };
    } else if (event === 'presence:drag') {
      data = {
        moves: (payload.moves || []).slice(0, 200)
          .filter((m) => m && Number.isFinite(m.position?.x) && Number.isFinite(m.position?.y))
          .map((m) => ({ nodeId: String(m.nodeId), position: { x: m.position.x, y: m.position.y } })),
      };
    } else if (event === 'presence:state') {
      peer.away = Boolean(payload.away);
      data = { away: peer.away };
    } else {
      return;
    }
    // Continuous streams (cursor, live drag) are volatile: under congestion a
    // stale position is dropped rather than queued, and the next one replaces
    // it anyway. Selection and away are discrete states - dropping one would
    // leave peers showing the wrong thing until the next change - so those are
    // sent reliably.
    const payloadOut = { workflowId: session.workflowId, socketId: socket.id, userId: peer.userId, ...data };
    const target = socket.to(room(session.workflowId));
    if (event === 'presence:cursor' || event === 'presence:drag') target.volatile.emit(event, payloadOut);
    else target.emit(event, payloadOut);
  }

  // ------------------------------------------------------------------ membership (spec/23)

  /** Role changed: refresh the cached permissions; a demoted user loses their locks. */
  onRoleChanged(userId, workspaceId, role) {
    const permissions = new Set(permissionsFor(role));
    for (const session of this.sessions.values()) {
      if (session.workspaceId !== String(workspaceId)) continue;
      for (const peer of session.peers.values()) {
        if (peer.userId !== String(userId)) continue;
        peer.role = role;
        peer.permissions = permissions;
        if (!permissions.has('workflow:edit')) {
          for (const [nodeId, lock] of session.locks) {
            if (lock.socketId === peer.socketId) this.#releaseLock(session, nodeId);
          }
        }
        // Re-announced so avatar stacks show the new role.
        io()?.to(room(session.workflowId)).emit('presence:join', { workflowId: session.workflowId, ...publicPeer(peer) });
      }
    }
  }

  /** Removed from the workspace (spec/24 eviction): drop their peers and locks. */
  evictUser(userId, workspaceId) {
    for (const session of this.sessions.values()) {
      if (session.workspaceId !== String(workspaceId)) continue;
      for (const peer of [...session.peers.values()]) {
        if (peer.userId === String(userId)) this.#removePeer(session, peer.socketId);
      }
    }
  }
}

export const hub = new CollabHub();

/**
 * Trigger settings aren't sequenced ops (spec/28 non-goals), but other peers'
 * Trigger panels should refresh. The webhook token never goes over this room -
 * viewers are in it - so peers who can manage triggers refetch to see it.
 */
export function broadcastTriggersChanged(workflow) {
  const w = workflow?.toObject ? workflow.toObject() : workflow;
  if (!w?._id) return;
  io()?.to(room(w._id)).emit('workflow:triggers_changed', {
    workflowId: String(w._id),
    triggers: {
      schedule: w.schedule || null,
      webhook: { enabled: Boolean(w.webhook?.enabled), hasToken: Boolean(w.webhook?.token) },
      eventTrigger: w.eventTrigger || null,
    },
  });
}

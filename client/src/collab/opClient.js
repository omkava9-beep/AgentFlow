import { applyOp, envelope, coalesceIdentity } from './ops.js';

/**
 * The client half of spec/28 §3: three layers of one workflow document.
 *
 *   confirmed  - the server's document at `confirmedSeq`
 *   pending    - this client's own ops, in order: sent-but-unacked, then unsent
 *   view       - confirmed with pending replayed on top (what's displayed)
 *
 * A remote op is applied to `confirmed` and pending is replayed on top of it.
 * With path-level last-writer-wins that replay *is* the whole rebase - no
 * operational transformation. An ack moves an op from pending into confirmed at
 * its seq; a reject drops it and the view recomputes, which is the rollback.
 *
 * Deliberately transport-agnostic (`send(op)` is injected) so check:logic can
 * drive two clients against a simulated server and assert convergence.
 */

/** Typing is sent at most this often per path (trailing edge). */
export const THROTTLE_MS = 150;

export class OpClient {
  constructor({ send = null, onChange = () => {}, onReject = () => {}, onGap = () => {}, throttleMs = THROTTLE_MS } = {}) {
    this.send = send;
    this.onChange = onChange;
    this.onReject = onReject;
    this.onGap = onGap;
    this.throttleMs = throttleMs;
    this.ready = false; // true once the server has given us a snapshot/catch-up
    this.flushTimer = null;
    this.reset({ name: '', nodes: [], edges: [] });
  }

  reset(doc, { seq = 0, sessionId = null } = {}) {
    this.confirmed = { name: doc.name || '', nodes: doc.nodes || [], edges: doc.edges || [] };
    this.confirmedSeq = seq;
    this.sessionId = sessionId;
    this.pending = []; // { op, sent }
    this.view = this.confirmed;
    this.clearTimer();
  }

  get pendingCount() {
    return this.pending.length;
  }

  get unackedCount() {
    return this.pending.filter((p) => p.sent).length;
  }

  hasPendingOp(opId) {
    return this.pending.some((p) => p.op.opId === opId);
  }

  recompute() {
    let doc = this.confirmed;
    for (const { op } of this.pending) {
      const result = applyOp(doc, op);
      // A pending op that no longer applies (its node was deleted remotely) just
      // drops out of the view; the server's reject will explain it shortly.
      if (result.ok) doc = result.doc;
    }
    this.view = doc;
    return doc;
  }

  /**
   * A local edit. Validated against the view, applied immediately, queued, and
   * sent (typing is throttled). Returns `{ ok, op }` or the reject reason.
   */
  local(bareOp) {
    const op = envelope(bareOp, this.confirmedSeq);
    const result = applyOp(this.view, op);
    if (!result.ok) return result;

    const identity = coalesceIdentity(op);
    const last = this.pending[this.pending.length - 1];
    if (identity && last && !last.sent && coalesceIdentity(last.op) === identity) {
      // Same field still waiting in the outbox: send only the latest value.
      last.op = op;
    } else {
      this.pending.push({ op, sent: false });
    }
    this.view = result.doc;

    if (identity) this.scheduleFlush();
    else this.flush();
    this.onChange({ local: op });
    return { ok: true, op, cascade: result.cascade };
  }

  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.throttleMs);
  }

  clearTimer() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  /** Sends every unsent op, in order. No-op until the session is ready. */
  flush() {
    this.clearTimer();
    if (!this.ready || !this.send) return;
    for (const entry of this.pending) {
      if (entry.sent) continue;
      entry.sent = true;
      this.send(entry.op);
    }
  }

  /** Server ack for one of our ops: `{ ok: true, seq }` or `{ ok: false, reason, current? }`. */
  ack(opId, ack) {
    const index = this.pending.findIndex((p) => p.op.opId === opId);
    if (index < 0) return; // already confirmed through a catch-up, or a stale duplicate
    const entry = this.pending[index];

    if (!ack?.ok) {
      this.pending.splice(index, 1);
      this.recompute();
      this.onReject(entry.op, ack || { ok: false, reason: 'invalid' });
      this.onChange({ rejected: entry.op });
      return;
    }

    if (ack.seq <= this.confirmedSeq) {
      // Already applied (a catch-up carried it); just retire it.
      this.pending.splice(index, 1);
      this.recompute();
      this.onChange({ acked: entry.op });
      return;
    }
    if (ack.seq !== this.confirmedSeq + 1) {
      // We missed a broadcast between our last confirmed op and this one.
      this.onGap({ reason: 'ack-gap', expected: this.confirmedSeq + 1, got: ack.seq });
      return;
    }
    const applied = applyOp(this.confirmed, entry.op);
    this.pending.splice(index, 1);
    if (!applied.ok) {
      // The server accepted what we can't apply - our confirmed copy has drifted.
      this.onGap({ reason: 'diverged' });
      return;
    }
    this.confirmed = applied.doc;
    this.confirmedSeq = ack.seq;
    this.recompute();
    this.onChange({ acked: entry.op });
  }

  /** A broadcast of someone else's op: `{ seq, op, by, cascade? }`. */
  remote({ seq, op, by }) {
    if (seq <= this.confirmedSeq) return false; // duplicate delivery
    if (seq !== this.confirmedSeq + 1) {
      this.onGap({ reason: 'broadcast-gap', expected: this.confirmedSeq + 1, got: seq });
      return false;
    }
    const applied = applyOp(this.confirmed, op);
    if (!applied.ok) {
      this.onGap({ reason: 'diverged' });
      return false;
    }
    this.confirmed = applied.doc;
    this.confirmedSeq = seq;
    // Defensive: if the server ever echoes our own op, it's no longer pending.
    this.pending = this.pending.filter((p) => p.op.opId !== op.opId);
    this.recompute();
    this.onChange({ remote: op, by });
    return true;
  }

  /**
   * Reconnect catch-up: the ops after our `confirmedSeq`, in order. Any of them
   * carrying one of our pending opIds means the server applied it before the
   * connection dropped - retire it rather than send it twice. Returns false if
   * the ops don't line up (the caller then asks for a snapshot).
   */
  catchUp({ sessionId, ops: entries = [] }) {
    if (sessionId) this.sessionId = sessionId;
    for (const entry of entries) {
      if (entry.seq <= this.confirmedSeq) continue;
      if (entry.seq !== this.confirmedSeq + 1) return false;
      const applied = applyOp(this.confirmed, entry.op);
      if (!applied.ok) return false;
      this.confirmed = applied.doc;
      this.confirmedSeq = entry.seq;
      this.pending = this.pending.filter((p) => p.op.opId !== entry.op?.opId);
    }
    this.afterResync();
    return true;
  }

  /** A full document from the server. Pending ops are rebased onto it and resent. */
  snapshot(snap) {
    this.confirmed = { name: snap.name || '', nodes: snap.nodes || [], edges: snap.edges || [] };
    this.confirmedSeq = snap.seq || 0;
    this.sessionId = snap.sessionId || null;
    this.afterResync();
  }

  afterResync() {
    // Whatever was in flight when we lost the connection goes out again; the
    // server acks a duplicate opId with its original seq instead of reapplying.
    for (const entry of this.pending) entry.sent = false;
    this.ready = true;
    this.recompute();
    this.flush();
    this.onChange({ resynced: true });
  }

  /** The connection dropped: nothing is in flight any more, everything waits. */
  disconnected() {
    this.ready = false;
    for (const entry of this.pending) entry.sent = false;
    this.clearTimer();
  }

  /**
   * REST fallback (a server without the collaboration hub): once a whole-document
   * save succeeds, everything that was pending is simply confirmed.
   */
  commitAll(doc = this.view) {
    this.commitPrefix(this.pending.length, doc);
  }

  /**
   * REST fallback, precisely: a save of `doc` - the view as it stood when the
   * first `count` pending ops were in it - succeeded. Edits made while the
   * request was in flight stay pending for the next save.
   */
  commitPrefix(count, doc) {
    this.confirmed = doc;
    this.pending = this.pending.slice(count);
    this.recompute();
    this.onChange({ committed: true });
  }
}

/** Human wording for a server reject (spec/28 §3). `who` resolves a userId to a name. */
export function rejectMessage(op, ack, who = () => null) {
  const target = op.nodeId ? 'this node' : op.edgeId ? 'this connection' : 'that change';
  switch (ack?.reason) {
    case 'not_found': {
      const name = who(ack?.by?.userId || ack?.deletedBy);
      return name ? `${name} deleted ${target} — your change was dropped.` : `Someone removed ${target} — your change was dropped.`;
    }
    case 'locked': {
      const name = ack?.heldBy?.name || who(ack?.heldBy?.userId);
      return `${name || 'Someone'} is editing ${target} — your change was dropped.`;
    }
    case 'forbidden':
      return "You don't have permission to edit this workflow.";
    case 'cycle':
      return 'That connection would create a cycle, so it was dropped.';
    case 'duplicate':
      return 'That already exists — your change was dropped.';
    default:
      return ack?.message || ack?.error || 'The server refused that change.';
  }
}

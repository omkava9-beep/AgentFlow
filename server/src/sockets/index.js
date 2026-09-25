import { authenticateToken } from '../utils/jwt.js';
import { queue } from '../queue/index.js';
import { authorizeRoom, emitToWorkspace } from './rooms.js';
import { registerCollabHandlers, joinWorkflow, leaveWorkflow } from '../collab/socketHandlers.js';

/** Room kinds a client may ask to join; `user:<id>` is joined automatically on connect. */
const ROOM_KINDS = ['workspace', 'run', 'workflow'];

function reply(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

export function registerSocketHandlers(io) {
  // Per workspace, not broadcast (spec/24): one tenant's pool usage is none of
  // another tenant's business. The queue only reports workspaces whose counts
  // actually changed, so this doesn't fan out to every room on every job.
  queue.on('workspace-stats', ({ workspaceId, ...stats }) => {
    emitToWorkspace(workspaceId, 'queue:stats', { workspaceId, ...stats });
  });

  // JWT handshake. A rejected connection surfaces as `connect_error: unauthorized`,
  // which the client treats exactly like an HTTP 401.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('unauthorized'));
    try {
      // Same check as requireAuth, tokenVersion included (spec/36 §4): a
      // session signed out by a password change can't reconnect either.
      const { userId, exp } = await authenticateToken(token);
      socket.data.userId = userId;
      socket.data.tokenExp = exp;
      // room -> workspaceId, so eviction knows which rooms belong to which tenant.
      socket.data.rooms = new Map();
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);

    // An idle connection isn't killed at expiry - it can't receive anything new
    // without subscribing, and every subscribe checks this.
    const expired = () => socket.data.tokenExp && Date.now() >= socket.data.tokenExp;

    registerCollabHandlers(socket);

    for (const kind of ROOM_KINDS) {
      socket.on(`${kind}:subscribe`, async (payload = {}, ack) => {
        try {
          if (expired()) return reply(ack, { ok: false, error: 'unauthorized' });
          const id = payload?.[`${kind}Id`];
          const result = await authorizeRoom(socket, kind, id);
          if (!result.ok) return reply(ack, result);

          // Workflow rooms are collaboration sessions (spec/28): the hub joins
          // the room and takes the snapshot in the same tick.
          if (kind === 'workflow') return reply(ack, await joinWorkflow(socket, id, payload, result.workspaceId));

          const room = `${kind}:${id}`;
          socket.join(room);
          socket.data.rooms.set(room, result.workspaceId);
          reply(ack, { ok: true });

          // Seed the queue indicator immediately rather than waiting for the
          // next change - a quiet workspace might not produce one for a while.
          if (kind === 'workspace') {
            socket.emit('queue:stats', { workspaceId: result.workspaceId, ...queue.statsFor(result.workspaceId) });
          }
        } catch (err) {
          console.error(`[socket] ${kind}:subscribe failed:`, err);
          reply(ack, { ok: false, error: 'not_found' });
        }
      });

      socket.on(`${kind}:unsubscribe`, (payload = {}, ack) => {
        if (kind === 'workflow') leaveWorkflow(socket, payload?.workflowId);
        const room = `${kind}:${payload?.[`${kind}Id`]}`;
        socket.leave(room);
        socket.data.rooms.delete(room);
        reply(ack, { ok: true });
      });
    }
  });
}

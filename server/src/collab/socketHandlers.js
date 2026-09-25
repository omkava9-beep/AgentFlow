import { hub } from './hub.js';

/**
 * Socket events for collaboration (spec/28's socket table). Joining the
 * `workflow:<id>` room itself is handled by sockets/index.js, which authorizes
 * the room (spec/24) and hands over to `hub.join` for the snapshot.
 */

function reply(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

const PRESENCE_EVENTS = ['presence:cursor', 'presence:select', 'presence:drag', 'presence:state'];

export function registerCollabHandlers(socket) {
  socket.on('collab:op', async (payload = {}, ack) => {
    try {
      reply(ack, await hub.submitOp(socket, payload.workflowId, payload.op));
    } catch (err) {
      console.error('[collab] collab:op failed:', err);
      reply(ack, { ok: false, reason: 'invalid' });
    }
  });

  socket.on('collab:lock', (payload = {}, ack) => reply(ack, hub.lock(socket, payload.workflowId, payload.nodeId)));
  socket.on('collab:unlock', (payload = {}, ack) => reply(ack, hub.unlock(socket, payload.workflowId, payload.nodeId)));
  socket.on('collab:lock_heartbeat', (payload = {}, ack) => reply(ack, hub.heartbeat(socket, payload.workflowId, payload.nodeId)));

  for (const event of PRESENCE_EVENTS) {
    socket.on(event, (payload = {}) => hub.presence(socket, event, payload));
  }

  socket.on('disconnect', () => hub.disconnect(socket));
}

/** `workflow:subscribe` after authorization: join the hub session and return the snapshot or catch-up. */
export function joinWorkflow(socket, workflowId, payload, workspaceId) {
  return hub.join(socket, workflowId, {
    workspaceId,
    sinceSeq: Number.isInteger(payload?.sinceSeq) ? payload.sinceSeq : undefined,
    sessionId: payload?.sessionId,
  });
}

export function leaveWorkflow(socket, workflowId) {
  hub.leave(socket, workflowId);
}

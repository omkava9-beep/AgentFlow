import Membership from '../models/Membership.js';
import Run from '../models/Run.js';
import Workflow from '../models/Workflow.js';
import { isValidObjectId } from '../tenancy/scoped.js';
import { getIo } from './ioInstance.js';

/**
 * Room authorization and targeted emits (spec/24). Every room join in the app
 * goes through `authorizeRoom`, so "can this socket see that room?" has exactly
 * one answer.
 *
 * Every helper is a no-op when Socket.io isn't initialized (check scripts, the
 * migration), so callers never need to guard.
 */

function io() {
  try {
    return getIo();
  } catch {
    return null;
  }
}

const NOT_FOUND = { ok: false, error: 'not_found' };

async function isMember(workspaceId, userId) {
  return Boolean(await Membership.exists({ workspaceId, userId }));
}

/**
 * Resolves which workspace a room belongs to and whether the socket's user is a
 * member of it. "Doesn't exist" and "not a member" are the same `not_found`, per
 * spec/22's 404 rule.
 *
 * The Run/Workflow lookups are by id only because the membership check right
 * after is what scopes them.
 */
export async function authorizeRoom(socket, kind, id) {
  const userId = socket.data?.userId;
  if (!userId || !isValidObjectId(String(id ?? ''))) return NOT_FOUND;

  let workspaceId;
  if (kind === 'workspace') {
    workspaceId = String(id);
  } else if (kind === 'run') {
    const run = await Run.findById(id).select('workspaceId').lean(); // tenancy: capability lookup (membership checked below)
    workspaceId = run?.workspaceId && String(run.workspaceId);
  } else if (kind === 'workflow') {
    const workflow = await Workflow.findById(id).select('workspaceId').lean(); // tenancy: capability lookup (membership checked below)
    workspaceId = workflow?.workspaceId && String(workflow.workspaceId);
  } else {
    return NOT_FOUND;
  }

  if (!workspaceId || !(await isMember(workspaceId, userId))) return NOT_FOUND;
  return { ok: true, workspaceId };
}

export function emitToUser(userId, event, payload) {
  io()?.to(`user:${userId}`).emit(event, payload);
}

export function emitToWorkspace(workspaceId, event, payload) {
  io()?.to(`workspace:${workspaceId}`).emit(event, payload);
}

/** This process's connected sockets for one user. Single instance, so this is all of them. */
function socketsOf(userId) {
  const server = io();
  if (!server) return [];
  return [...server.of('/').sockets.values()].filter((s) => s.data?.userId === String(userId));
}

/**
 * Called by spec/23 when a member is removed or leaves: every open socket of that
 * user drops every room that belongs to the workspace, then gets told why. Role
 * changes don't evict - viewers can still read.
 */
export function evictFromWorkspace(userId, workspaceId) {
  const target = String(workspaceId);
  for (const socket of socketsOf(userId)) {
    const rooms = socket.data.rooms;
    if (!rooms) continue;
    for (const [room, roomWorkspaceId] of rooms) {
      if (roomWorkspaceId !== target) continue;
      socket.leave(room);
      rooms.delete(room);
    }
  }
  emitToUser(userId, 'workspace:access_revoked', { workspaceId: target });
}

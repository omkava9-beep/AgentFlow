import { apiClient } from './client';

// The workspace is in the path (spec/23), so these need no X-Workspace-Id.
const base = (workspaceId) => `/workspaces/${workspaceId}/members`;

export const listMembers = (workspaceId) => apiClient.get(base(workspaceId)).then((r) => r.data);
export const updateMemberRole = (workspaceId, userId, role) =>
  apiClient.patch(`${base(workspaceId)}/${userId}`, { role }).then((r) => r.data);
/** Removing yourself is how you leave a workspace. */
export const removeMember = (workspaceId, userId) => apiClient.delete(`${base(workspaceId)}/${userId}`);
/** `{ seatsUsed, seatLimit, plan, atLimit }`: members plus pending invites vs the plan (spec/33 §6). */
export const getSeats = (workspaceId) => apiClient.get(`${base(workspaceId)}/seats`).then((r) => r.data);

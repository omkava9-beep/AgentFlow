import axios from 'axios';
import { apiClient } from './client';

const base = (workspaceId) => `/workspaces/${workspaceId}/invitations`;

export const listInvitations = (workspaceId) => apiClient.get(base(workspaceId)).then((r) => r.data);
/** Resolves `{ invitation, inviteUrl }` - the only time the link is available. */
export const createInvitation = (workspaceId, { email, role }) =>
  apiClient.post(base(workspaceId), { email, role }).then((r) => r.data);
/** Issues a new token (the old link dies) and returns the new `inviteUrl`. */
export const resendInvitation = (workspaceId, invId) =>
  apiClient.post(`${base(workspaceId)}/${invId}/resend`).then((r) => r.data);
export const revokeInvitation = (workspaceId, invId) => apiClient.delete(`${base(workspaceId)}/${invId}`);

/**
 * Bare axios, like the share page: the invitee may be signed out, and apiClient
 * would turn a 401 into a redirect to /login and attach a stale workspace id.
 */
export const getInvitation = (token) =>
  axios.get(`${import.meta.env.VITE_API_URL}/invitations/${encodeURIComponent(token)}`).then((r) => r.data);

export const acceptInvitation = (token) =>
  apiClient.post(`/invitations/${encodeURIComponent(token)}/accept`).then((r) => r.data);

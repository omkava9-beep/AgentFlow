import { apiClient } from './client';

export const listWorkspaces = () => apiClient.get('/workspaces').then((r) => r.data);
export const createWorkspace = (name) => apiClient.post('/workspaces', { name }).then((r) => r.data);
export const getWorkspaceBySlug = (slug) =>
  apiClient.get(`/workspaces/by-slug/${encodeURIComponent(slug)}`).then((r) => r.data);
export const updateWorkspace = (id, payload) => apiClient.patch(`/workspaces/${id}`, payload).then((r) => r.data);
export const deleteWorkspace = (id, confirmName) =>
  apiClient.delete(`/workspaces/${id}`, { data: { confirmName } });

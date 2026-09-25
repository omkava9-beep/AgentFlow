import { apiClient } from './client';

/** This workspace's slice of the in-process machinery (spec/36 §7). */
export const getWorkspaceStatus = (workspaceId) =>
  apiClient.get(`/workspaces/${workspaceId}/status`).then((r) => r.data);

/** Pool-wide view for OPERATOR_EMAILS only; 404 for everyone else. */
export const getGlobalStatus = () => apiClient.get('/status/global').then((r) => r.data);

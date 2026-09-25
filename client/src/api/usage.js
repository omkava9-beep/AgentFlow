import { apiClient } from './client';

// Path-scoped to the workspace (spec/33), like the rest of /workspaces/:id/*.
export const getUsage = (workspaceId, days = 30) =>
  apiClient.get(`/workspaces/${workspaceId}/usage`, { params: { days } }).then((r) => r.data);
export const listPlans = () => apiClient.get('/plans').then((r) => r.data);
/** Simulated: no payment is taken, the workspace's plan field just changes. */
export const changePlan = (workspaceId, plan) =>
  apiClient.patch(`/workspaces/${workspaceId}/plan`, { plan }).then((r) => r.data);

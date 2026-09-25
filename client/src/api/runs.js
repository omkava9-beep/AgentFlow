import { apiClient } from './client';

export const getRun = (id) => apiClient.get(`/runs/${id}`).then((r) => r.data);
export const cancelRun = (id) => apiClient.post(`/runs/${id}/cancel`).then((r) => r.data);

// spec/35: re-run, retry from failed, and workspace-wide search.
export const rerunRun = (id) => apiClient.post(`/runs/${id}/rerun`).then((r) => r.data);
export const getRetryPlan = (id, fromNodeIds) =>
  apiClient.get(`/runs/${id}/retry-plan`, { params: fromNodeIds?.length ? { fromNodeIds: fromNodeIds.join(',') } : {} }).then((r) => r.data);
export const retryRun = (id, fromNodeIds) =>
  apiClient.post(`/runs/${id}/retry`, fromNodeIds?.length ? { fromNodeIds } : {}).then((r) => r.data);
/** `params` are the Runs page filters; `cursor` continues from the previous page. */
export const searchRuns = (params) => apiClient.get('/runs', { params }).then((r) => r.data);

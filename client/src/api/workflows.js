import { apiClient } from './client';

export const listWorkflows = () => apiClient.get('/workflows').then((r) => r.data);
export const createWorkflow = (name) => apiClient.post('/workflows', { name }).then((r) => r.data);
export const getWorkflow = (id) => apiClient.get(`/workflows/${id}`).then((r) => r.data);
export const updateWorkflow = (id, payload) => apiClient.put(`/workflows/${id}`, payload).then((r) => r.data);
export const deleteWorkflow = (id) => apiClient.delete(`/workflows/${id}`);
// spec/30: 'draft' is the Builder's test run; 'published' runs the live version.
// `input` is an optional test payload handed to the Start node (e.g. a template's sample input).
export const createRun = (workflowId, source = 'draft', input) =>
  apiClient.post(`/workflows/${workflowId}/runs`, { source, ...(input != null && { input }) }).then((r) => r.data);
export const listRuns = (workflowId, page = 1) =>
  apiClient.get(`/workflows/${workflowId}/runs`, { params: { page } }).then((r) => r.data);

// --- triggers (spec/12, 13, 21) ---
export const putSchedule = (id, schedule) =>
  apiClient.put(`/workflows/${id}/schedule`, schedule).then((r) => r.data);
export const deleteSchedule = (id) => apiClient.delete(`/workflows/${id}/schedule`);
export const regenerateWebhook = (id) =>
  apiClient.post(`/workflows/${id}/webhook/regenerate`).then((r) => r.data);
export const putWebhook = (id, payload) =>
  apiClient.put(`/workflows/${id}/webhook`, payload).then((r) => r.data);
export const putEventTrigger = (id, payload) =>
  apiClient.put(`/workflows/${id}/event-trigger`, payload).then((r) => r.data);
export const deleteEventTrigger = (id) => apiClient.delete(`/workflows/${id}/event-trigger`);

// --- versions (spec/30) ---
export const publishWorkflow = (id, { message, acknowledgeWarnings } = {}) =>
  apiClient.post(`/workflows/${id}/publish`, { message, acknowledgeWarnings }).then((r) => r.data);
export const listVersions = (id) => apiClient.get(`/workflows/${id}/versions`).then((r) => r.data);
export const getVersion = (id, version) => apiClient.get(`/workflows/${id}/versions/${version}`).then((r) => r.data);
export const diffVersions = (id, from, to = 'draft') =>
  apiClient.get(`/workflows/${id}/diff`, { params: { from, to } }).then((r) => r.data);
export const restoreVersion = (id, version) =>
  apiClient.post(`/workflows/${id}/versions/${version}/restore`).then((r) => r.data);
export const rollbackVersion = (id, version, message) =>
  apiClient.post(`/workflows/${id}/versions/${version}/rollback`, { message }).then((r) => r.data);

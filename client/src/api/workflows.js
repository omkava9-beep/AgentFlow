import { apiClient } from './client';

export const listWorkflows = () => apiClient.get('/workflows').then((r) => r.data);
export const createWorkflow = (name) => apiClient.post('/workflows', { name }).then((r) => r.data);
export const getWorkflow = (id) => apiClient.get(`/workflows/${id}`).then((r) => r.data);
export const updateWorkflow = (id, payload) => apiClient.put(`/workflows/${id}`, payload).then((r) => r.data);
export const deleteWorkflow = (id) => apiClient.delete(`/workflows/${id}`);
export const createRun = (workflowId) => apiClient.post(`/workflows/${workflowId}/runs`).then((r) => r.data);
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

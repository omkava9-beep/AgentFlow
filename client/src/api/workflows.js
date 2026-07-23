import { apiClient } from './client';

export const listWorkflows = () => apiClient.get('/workflows').then((r) => r.data);
export const createWorkflow = (name) => apiClient.post('/workflows', { name }).then((r) => r.data);
export const getWorkflow = (id) => apiClient.get(`/workflows/${id}`).then((r) => r.data);
export const updateWorkflow = (id, payload) => apiClient.put(`/workflows/${id}`, payload).then((r) => r.data);
export const deleteWorkflow = (id) => apiClient.delete(`/workflows/${id}`);
export const createRun = (workflowId) => apiClient.post(`/workflows/${workflowId}/runs`).then((r) => r.data);
export const listRuns = (workflowId, page = 1) =>
  apiClient.get(`/workflows/${workflowId}/runs`, { params: { page } }).then((r) => r.data);

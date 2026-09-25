import { apiClient } from './client';

export const listTemplates = () => apiClient.get('/templates').then((r) => r.data);
export const createTemplate = (payload) => apiClient.post('/templates', payload).then((r) => r.data);
// Not `useTemplate`: a `use*` name reads as a React hook to both tooling and
// readers, and this is a plain API call.
export const createWorkflowFromTemplate = (id, workflowName) =>
  apiClient.post(`/templates/${id}/use`, { workflowName }).then((r) => r.data);

/** Workspace templates only; built-ins answer 403 (spec/36 §5). */
export const updateTemplate = (id, patch) => apiClient.patch(`/templates/${id}`, patch).then((r) => r.data);
export const deleteTemplate = (id) => apiClient.delete(`/templates/${id}`);

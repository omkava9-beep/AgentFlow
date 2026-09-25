import { apiClient } from './client';

export const listTemplates = () => apiClient.get('/templates').then((r) => r.data);
export const createTemplate = (payload) => apiClient.post('/templates', payload).then((r) => r.data);
// Not `useTemplate`: a `use*` name reads as a React hook to both tooling and
// readers, and this is a plain API call.
// No name → the server decides: a built-in keeps its own name, a copy of one
// of your templates gets " copy" (spec/15).
export const createWorkflowFromTemplate = (id, workflowName) =>
  apiClient.post(`/templates/${id}/use`, workflowName ? { workflowName } : {}).then((r) => r.data);
/** Detail: the graph, plus the companion workflows "Use template" also creates. */
export const getTemplate = (id) => apiClient.get(`/templates/${id}`).then((r) => r.data);

/** Workspace templates only; built-ins answer 403 (spec/36 §5). */
export const updateTemplate = (id, patch) => apiClient.patch(`/templates/${id}`, patch).then((r) => r.data);
export const deleteTemplate = (id) => apiClient.delete(`/templates/${id}`);

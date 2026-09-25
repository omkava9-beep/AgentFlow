import { apiClient } from './client';

// Workspace-scoped (spec/29): the client's X-Workspace-Id header picks the tenant.
export const listThreads = (workflowId) => apiClient.get(`/workflows/${workflowId}/threads`).then((r) => r.data);
export const createThread = (workflowId, { anchor, body }) =>
  apiClient.post(`/workflows/${workflowId}/threads`, { anchor, body }).then((r) => r.data);
export const replyToThread = (threadId, body) => apiClient.post(`/threads/${threadId}/comments`, { body }).then((r) => r.data);
export const editComment = (commentId, body) => apiClient.patch(`/comments/${commentId}`, { body }).then((r) => r.data);
export const deleteComment = (commentId) => apiClient.delete(`/comments/${commentId}`);
export const resolveThread = (threadId) => apiClient.post(`/threads/${threadId}/resolve`).then((r) => r.data);
export const reopenThread = (threadId) => apiClient.post(`/threads/${threadId}/reopen`).then((r) => r.data);
export const repinThread = (threadId, anchor) => apiClient.patch(`/threads/${threadId}`, { anchor }).then((r) => r.data);

export const getWatch = (workflowId) => apiClient.get(`/workflows/${workflowId}/watch`).then((r) => r.data);
export const watchWorkflow = (workflowId) => apiClient.put(`/workflows/${workflowId}/watch`);
export const unwatchWorkflow = (workflowId) => apiClient.delete(`/workflows/${workflowId}/watch`);

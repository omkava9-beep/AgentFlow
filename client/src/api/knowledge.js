import { apiClient } from './client';

/** Knowledge Base documents (spec/27 §7), for the current workspace. */
export const listKnowledge = () => apiClient.get('/knowledge').then((r) => r.data);
export const getKnowledgeDoc = (id) => apiClient.get(`/knowledge/${id}`).then((r) => r.data);
export const addKnowledgeDoc = (body) => apiClient.post('/knowledge', body).then((r) => r.data);
export const deleteKnowledgeDoc = (id) => apiClient.delete(`/knowledge/${id}`);
export const searchKnowledge = (q, topK = 3) =>
  apiClient.get('/knowledge/search', { params: { q, topK } }).then((r) => r.data);

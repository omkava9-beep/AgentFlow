import { apiClient } from './client';

/** `{ tools: [{ type, label }], defaults: { failureRate, maxAttempts } }` */
export const listTools = () => apiClient.get('/tools').then((r) => r.data);

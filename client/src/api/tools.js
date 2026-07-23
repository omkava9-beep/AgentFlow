import { apiClient } from './client';

export const listTools = () => apiClient.get('/tools').then((r) => r.data);

import { apiClient } from './client';

export const getRun = (id) => apiClient.get(`/runs/${id}`).then((r) => r.data);

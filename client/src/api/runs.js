import { apiClient } from './client';

export const getRun = (id) => apiClient.get(`/runs/${id}`).then((r) => r.data);
export const cancelRun = (id) => apiClient.post(`/runs/${id}/cancel`).then((r) => r.data);

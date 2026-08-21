import { apiClient } from './client';

export const getAnalyticsSummary = (days = 30) =>
  apiClient.get('/analytics/summary', { params: { days } }).then((r) => r.data);

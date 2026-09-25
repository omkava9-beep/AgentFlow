import { apiClient } from './client';

/** `workflowId` (spec/35 §5) narrows every aggregation to one workflow and adds nodeStats. */
export const getAnalyticsSummary = (days = 30, workflowId = null) =>
  apiClient.get('/analytics/summary', { params: { days, ...(workflowId && { workflowId }) } }).then((r) => r.data);

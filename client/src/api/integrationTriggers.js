import { apiClient } from './client';

/**
 * spec/27 §5: fire a trigger's sample payload through the real per-workspace
 * fan-out, marked `test: true`. → `{ triggered: [runId], skipped: [...] }`
 */
export const sendTestEvent = (integrationId, triggerId, connectionId = null) =>
  apiClient
    .post(`/integrations/${integrationId}/triggers/${triggerId}/test`, connectionId ? { connectionId } : {})
    .then((r) => r.data);

/** "Check feed now" for an RSS connection (spec/27 §6). */
export const pollFeedNow = (connectionId) =>
  apiClient.post('/integrations/rss/poll', { connectionId }).then((r) => r.data);

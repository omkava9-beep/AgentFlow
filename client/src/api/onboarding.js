import { apiClient } from './client';

/** `{ steps: [{ key, done, canDo }], dismissed, complete }` (spec/36 §2). */
export const getOnboarding = (workspaceId) =>
  apiClient.get(`/workspaces/${workspaceId}/onboarding`).then((r) => r.data);

export const dismissOnboarding = (workspaceId) =>
  apiClient.post(`/workspaces/${workspaceId}/onboarding/dismiss`);

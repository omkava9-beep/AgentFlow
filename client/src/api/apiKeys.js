import { apiClient } from './client';

// Workspace-scoped through the path (spec/24), like the rest of /workspaces.
const base = (workspaceId) => `/workspaces/${workspaceId}/api-keys`;

export const listApiKeys = (workspaceId) => apiClient.get(base(workspaceId)).then((r) => r.data);
/** Resolves `{ apiKey, key }` - `key` is the only time the plaintext is ever sent. */
export const createApiKey = (workspaceId, payload) => apiClient.post(base(workspaceId), payload).then((r) => r.data);
export const revokeApiKey = (workspaceId, keyId) => apiClient.delete(`${base(workspaceId)}/${keyId}`);

export const API_KEY_SCOPES = [
  { value: 'events:publish', label: 'Publish events', hint: 'POST /api/w/:slug/events/:name' },
  { value: 'runs:create', label: 'Start runs', hint: 'POST /api/w/:slug/workflows/:id/runs' },
  { value: 'runs:read', label: 'Read runs', hint: 'GET /api/w/:slug/runs/:id' },
];

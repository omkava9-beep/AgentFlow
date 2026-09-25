import { apiClient } from './client';

/**
 * `{ integrations: [...manifests], defaults: { failureRate, maxAttempts },
 * liveEnabled, features }` (spec/26). `features` carries operator switches the
 * palette needs, e.g. `{ codeNode }` (spec/31's CODE_NODE_ENABLED).
 */
export async function listIntegrations() {
  const { data } = await apiClient.get('/integrations');
  return {
    integrations: data.integrations || [],
    defaults: data.defaults || null,
    liveEnabled: data.liveEnabled,
    features: data.features || {},
  };
}

export const getIntegration = (id) => apiClient.get(`/integrations/${id}`).then((r) => r.data);

/** Static actions plus any the connection discovers (spec/37's MCP tools). */
export const listIntegrationActions = (id, connectionId) =>
  apiClient
    .get(`/integrations/${id}/actions`, { params: connectionId ? { connectionId } : {} })
    .then((r) => r.data);

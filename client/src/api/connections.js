import { apiClient } from './client';

/**
 * Workspace connections (spec/25). Credentials are write-only: nothing here
 * ever receives a secret back, only `credentialHints`.
 */
export const listConnections = (integration) =>
  apiClient.get('/connections', { params: integration ? { integration } : {} }).then((r) => r.data);

export const getConnection = (id) => apiClient.get(`/connections/${id}`).then((r) => r.data);

/** `{ integration, name, mode?, credentials: { secret fields }, config: { non-secret fields } }` */
export const createConnection = (body) => apiClient.post('/connections', body).then((r) => r.data);

/** Credentials merge: a present field replaces, an omitted one is kept, `null` clears. */
export const updateConnection = (id, body) => apiClient.patch(`/connections/${id}`, body).then((r) => r.data);

export const testConnection = (id) => apiClient.post(`/connections/${id}/test`).then((r) => r.data);

/** Generates (or rotates) the connection's inbound webhook URL (spec/27). */
export const createInboundToken = (id) => apiClient.post(`/connections/${id}/inbound-token`).then((r) => r.data);

export const connectionUsage = (id) => apiClient.get(`/connections/${id}/usage`).then((r) => r.data);

/** Without `force` a referenced connection answers 409 `{ usage }`. */
export const deleteConnection = (id, { force = false } = {}) =>
  apiClient.delete(`/connections/${id}`, { params: force ? { force: true } : {} });

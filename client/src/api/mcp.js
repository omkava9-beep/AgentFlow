import { apiClient } from './client';
import { useWorkspaceStore } from '../store/workspaceStore';
import { listIntegrationActions } from './integrations';

/**
 * MCP discovery (spec/37). Tools are listed per connection, from the live
 * server, the TTL cache or the saved snapshot — `source` says which.
 *
 * Responses are normalised to `{ tools, fetchedAt, source }` whichever route
 * answered: the spec's workspace-scoped route, the same router mounted under
 * `/api/connections`, or the registry's generic dynamic-actions endpoint.
 */
const workspacePath = (connectionId, suffix) => {
  const wsId = useWorkspaceStore.getState().current?.id;
  return wsId ? `/workspaces/${wsId}/connections/${connectionId}/mcp/${suffix}` : `/connections/${connectionId}/mcp/${suffix}`;
};

const normalise = (data) => ({
  tools: data?.tools || [],
  fetchedAt: data?.fetchedAt || null,
  source: data?.source || null,
  serverInfo: data?.serverInfo || null,
});

export async function listMcpTools(connectionId) {
  try {
    const { data } = await apiClient.get(workspacePath(connectionId, 'tools'));
    return normalise(data);
  } catch (err) {
    if (err?.response?.status !== 404) throw err;
    // Only the generic endpoint exists: actions are already in manifest shape.
    const data = await listIntegrationActions('mcp', connectionId);
    const actions = data?.actions || data || [];
    return {
      tools: actions.map((a) => ({ ...a, name: a.id, title: a.name })),
      fetchedAt: null,
      source: null,
      serverInfo: null,
    };
  }
}

/** Runs `tools/list` again on the server and replaces the saved snapshot. */
export const refreshMcpTools = (connectionId) =>
  apiClient.post(workspacePath(connectionId, 'refresh')).then((r) => normalise(r.data));

/** Operator-allowlisted local servers: `[{ id, name, description }]`, never the command. */
export const listMcpAllowlist = () => apiClient.get('/mcp/allowlist').then((r) => r.data?.servers || r.data || []);

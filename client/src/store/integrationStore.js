import { create } from 'zustand';
import { listIntegrations } from '../api/integrations';
import { listConnections } from '../api/connections';

/**
 * The integration catalogue and this workspace's connections, loaded once per
 * builder session and shared by the config panel, the canvas nodes (for their
 * icon and LIVE/SANDBOX badge) and the validator.
 *
 * The catalogue is the same for every workspace; connections aren't, so they
 * are keyed by the workspace they were loaded for.
 */
export const useIntegrationStore = create((set, get) => ({
  catalog: null,
  defaults: null,
  liveEnabled: undefined,
  features: {},
  catalogError: null,
  connections: null,
  connectionsWorkspaceId: null,

  loadCatalog: async ({ force = false } = {}) => {
    if (get().catalog && !force) return get().catalog;
    try {
      const { integrations, defaults, liveEnabled, features = {} } = await listIntegrations();
      set({ catalog: integrations, defaults, liveEnabled, features, catalogError: null });
      return integrations;
    } catch (err) {
      set({ catalogError: err });
      return null;
    }
  },

  loadConnections: async (workspaceId, { force = false } = {}) => {
    if (!force && get().connections && get().connectionsWorkspaceId === workspaceId) return get().connections;
    try {
      const list = await listConnections();
      set({ connections: list, connectionsWorkspaceId: workspaceId });
      return list;
    } catch {
      // 404 before spec/25's server lands, or a transient failure: the picker
      // still offers Sandbox/None, and the validator skips connection checks.
      set({ connections: null, connectionsWorkspaceId: workspaceId });
      return null;
    }
  },

  upsertConnection: (connection) =>
    set((s) => ({
      connections: [...(s.connections || []).filter((c) => c.id !== connection.id), connection],
    })),

  removeConnection: (id) => set((s) => ({ connections: (s.connections || []).filter((c) => c.id !== id) })),
}));

export const connectionById = (connections, id) =>
  (connections || []).find((c) => c.id === id || c._id === id) || null;

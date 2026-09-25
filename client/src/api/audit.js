import { apiClient } from './client';

// Workspace-scoped through the path, like the rest of /workspaces (spec/34).
const base = (workspaceId) => `/workspaces/${workspaceId}/audit`;

const clean = (filters = {}) =>
  Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/** Resolves `{ items, nextCursor }`; pass `before: nextCursor` for the next page. */
export const listAudit = (workspaceId, filters) =>
  apiClient.get(base(workspaceId), { params: clean(filters) }).then((r) => r.data);

/**
 * The export needs the auth header, so it can't be a plain link: fetch it as a
 * blob and hand the browser an object URL to save.
 */
export async function downloadAuditCsv(workspaceId, filters, filename = 'audit.csv') {
  const res = await apiClient.get(`${base(workspaceId)}/export`, { params: clean(filters), responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

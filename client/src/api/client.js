import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore, defaultWorkspace, workspacePath } from '../store/workspaceStore';
import { useToastStore } from '../store/toastStore';
import { navigateTo } from '../navigation';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

// Auth and the workspace endpoints identify their workspace (if any) through
// the path, so they never get the header - a stale id there would only confuse.
const UNSCOPED_PREFIXES = ['/auth', '/workspaces', '/invitations', '/outbox', '/notifications'];
const isUnscoped = (url = '') => UNSCOPED_PREFIXES.some((p) => url === p || url.startsWith(`${p}/`));

apiClient.interceptors.request.use((config) => {
  const { token } = useAuthStore.getState();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const { current } = useWorkspaceStore.getState();
  if (current && !isUnscoped(config.url)) {
    config.headers['X-Workspace-Id'] = current.id;
  }
  return config;
});

let recovering = null;

/**
 * A 404 "Workspace not found" on a request that carried the header means the
 * membership is gone (removed, or the workspace was deleted). Refresh the list
 * and fall back to the personal workspace - once, however many requests failed.
 */
function recoverFromLostWorkspace(lostName) {
  if (recovering) return recovering;
  recovering = apiClient
    .get('/workspaces')
    .then(({ data }) => {
      const store = useWorkspaceStore.getState();
      store.setWorkspaces(data);
      const fallback = data.find((w) => w.personal) || defaultWorkspace(data);
      useToastStore
        .getState()
        .push(`You no longer have access to ${lostName ? `“${lostName}”` : 'that workspace'}.`, 'error');
      if (fallback) navigateTo(workspacePath(fallback.slug, '/dashboard'));
    })
    .catch(() => {})
    .finally(() => {
      recovering = null;
    });
  return recovering;
}

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    if (status === 401) {
      useAuthStore.getState().logout();
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    } else if (
      status === 404 &&
      error.response?.data?.error === 'Workspace not found' &&
      error.config?.headers?.['X-Workspace-Id']
    ) {
      recoverFromLostWorkspace(useWorkspaceStore.getState().current?.name);
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(err, fallback = 'Something went wrong') {
  return err?.response?.data?.error || fallback;
}

export const isNotFound = (err) => err?.response?.status === 404;

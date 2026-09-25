import { apiClient } from './client';

/** spec/36 §1: names and ids only, scoped to the current workspace. */
export const searchWorkspace = (q, { signal } = {}) =>
  apiClient.get('/search', { params: { q }, signal }).then((r) => r.data);

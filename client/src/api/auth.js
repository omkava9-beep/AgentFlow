import { apiClient } from './client';

export const register = (email, password, name) =>
  apiClient.post('/auth/register', { email, password, ...(name ? { name } : {}) }).then((r) => r.data);

export const login = (email, password) =>
  apiClient.post('/auth/login', { email, password }).then((r) => r.data);

export const me = () => apiClient.get('/auth/me').then((r) => r.data);

/** Profile (spec/36 §4). */
export const updateMe = (name) => apiClient.patch('/auth/me', { name }).then((r) => r.data);

/** Returns `{ token }`: a fresh token for this session; every other session is signed out. */
export const changePassword = (currentPassword, newPassword) =>
  apiClient.post('/auth/password', { currentPassword, newPassword }).then((r) => r.data);

/** "Sign out of all other sessions": returns a fresh `{ token }` for this one. */
export const revokeOtherSessions = () => apiClient.post('/auth/sessions/revoke').then((r) => r.data);

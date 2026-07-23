import { apiClient } from './client';

export const register = (email, password) =>
  apiClient.post('/auth/register', { email, password }).then((r) => r.data);

export const login = (email, password) =>
  apiClient.post('/auth/login', { email, password }).then((r) => r.data);

export const me = () => apiClient.get('/auth/me').then((r) => r.data);

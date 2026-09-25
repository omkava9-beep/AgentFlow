import { apiClient } from './client';

// JWT only, across every workspace you're in (spec/29) - no X-Workspace-Id.
export const listNotifications = ({ unread = false, before, limit } = {}) =>
  apiClient
    .get('/notifications', { params: { ...(unread && { unread: true }), ...(before && { before }), ...(limit && { limit }) } })
    .then((r) => r.data);
export const markNotificationRead = (id) => apiClient.post(`/notifications/${id}/read`);
export const markAllNotificationsRead = () => apiClient.post('/notifications/read-all');

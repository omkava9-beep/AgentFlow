import axios from 'axios';
import { apiClient, API_BASE_URL } from './client';

export const createShareLink = (workflowId) =>
  apiClient.post(`/workflows/${workflowId}/share`).then((r) => r.data);

export const deleteShareLink = (workflowId) => apiClient.delete(`/workflows/${workflowId}/share`);

/**
 * Deliberately a bare axios call, not `apiClient`: that instance attaches the
 * stored JWT and, on a 401, logs the user out and redirects to /login. A shared
 * link is meant to work for someone who isn't logged in at all, and a 404 here
 * must render a "link not found" page rather than bounce them to a login screen.
 */
export const getSharedWorkflow = (shareToken) =>
  axios.get(`${API_BASE_URL}/shared/${shareToken}`).then((r) => r.data);

/** spec/35 §4: the whitelisted detail of one run behind a share link. Bare axios, as above. */
export const getSharedRun = (shareToken, runId) =>
  axios.get(`${API_BASE_URL}/shared/${shareToken}/runs/${runId}`).then((r) => r.data);

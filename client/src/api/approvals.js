import axios from 'axios';
import { apiClient } from './client';

/** The caller's approvals inbox (spec/32). `all` needs runs:approve_any. */
export const listApprovals = ({ status = 'pending', all = false } = {}) =>
  apiClient.get('/approvals', { params: { status, ...(all && { all: 1 }) } }).then((r) => r.data);

/** `decision` is 'approve' | 'reject'. A 409 body carries the decision that won. */
export const decideApproval = (runId, nodeId, decision, comment = '') =>
  apiClient.post(`/runs/${runId}/approvals/${encodeURIComponent(nodeId)}`, { decision, comment }).then((r) => r.data);

/**
 * Bare axios for the signed link page: the approver may be signed out, and
 * apiClient would turn a 401 into a redirect and attach a workspace id.
 */
const linkUrl = (token) => `${import.meta.env.VITE_API_URL}/approval-links/${encodeURIComponent(token)}`;
export const getApprovalLink = (token) => axios.get(linkUrl(token)).then((r) => r.data);
export const decideApprovalLink = (token, decision, comment = '') =>
  axios.post(linkUrl(token), { decision, comment }).then((r) => r.data);

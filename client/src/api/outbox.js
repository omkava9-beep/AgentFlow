import { apiClient } from './client';

/** Dev mail (spec/23): only messages addressed to the signed-in user. */
export const listOutbox = () => apiClient.get('/outbox').then((r) => r.data);

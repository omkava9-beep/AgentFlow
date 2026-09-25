import { env } from './env.js';

/**
 * The one place `INTEGRATIONS_LIVE` is read (spec/26 §3, CLAUDE.md). Live calls
 * are the default (C2); `false` is the offline / deterministic-checks switch.
 */
export const integrationsConfig = Object.freeze({
  live: env.integrationsLive,
});

import { integrationsConfig } from '../config/integrations.js';

/**
 * spec/26 §3 — decided per node execution, never stored on the node:
 *
 *   live ⇔ INTEGRATIONS_LIVE
 *        && the action has a live implementation
 *        && ( connection.mode === 'live'
 *             || (auth.type === 'none' && connection?.mode !== 'sandbox') )
 *
 * | Situation                                   | Mode    |
 * |---------------------------------------------|---------|
 * | Slack, live connection, live enabled        | live    |
 * | Slack, no connection                        | sandbox |
 * | Slack, connectionId 'sandbox'               | sandbox |
 * | HTTP, no connection                         | live    |
 * | HTTP, live bearer connection                | live    |
 * | HTTP, connectionId 'sandbox'                | sandbox |
 * | anything, INTEGRATIONS_LIVE=false           | sandbox |
 * | no live adapter (e.g. Jira), any connection | sandbox |
 *
 * `liveEnabled` is injectable so the rule can be tested exhaustively without
 * touching the environment.
 */
export function decideMode({ manifest, action, connection = null, liveEnabled = integrationsConfig.live }) {
  if (!liveEnabled) return 'sandbox';
  if (typeof action?.live !== 'function') return 'sandbox';
  if (connection?.mode === 'live') return 'live';
  if (manifest?.auth?.type === 'none' && connection?.mode !== 'sandbox') return 'live';
  return 'sandbox';
}

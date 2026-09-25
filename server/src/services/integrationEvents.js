import { dispatchWorkspaceEvent } from './eventService.js';

/**
 * spec/26 §7's event envelope - what the Start node of a workflow subscribed to
 * an integration trigger receives. The same shape whether the event came from a
 * real provider, the RSS poller or "Send test event".
 */
export function integrationEnvelope({ integration, triggerId, connectionId = null, test = false, data = null, deliveryId = null }) {
  return {
    event: `${integration}.${triggerId}`,
    integration,
    connectionId: connectionId ? String(connectionId) : null,
    test: Boolean(test),
    receivedAt: new Date().toISOString(),
    ...(deliveryId && { deliveryId }),
    data,
  };
}

/** Fans an integration trigger out to this workspace's subscribers (spec/24 + spec/26 §7). */
export function dispatchIntegrationEvent(workspaceId, fields) {
  const envelope = integrationEnvelope(fields);
  return dispatchWorkspaceEvent(workspaceId, envelope.event, envelope, { connectionId: fields.connectionId || null });
}

import Connection from '../models/Connection.js';
import { IntegrationRegistry } from '../integrations/IntegrationRegistry.js';
import { dispatchIntegrationEvent } from '../services/integrationEvents.js';
import { pollConnection } from '../scheduler/rssPoller.js';
import { isValidObjectId } from '../tenancy/scoped.js';
import { HttpError } from '../middleware/errorHandler.js';

async function connectionFor(req, integration, connectionId) {
  if (!connectionId) return null;
  const conn = isValidObjectId(connectionId)
    ? await Connection.findOne({ _id: connectionId, workspaceId: req.workspaceId })
    : null;
  if (!conn) throw new HttpError(404, 'Connection not found');
  if (conn.integration !== integration) throw new HttpError(400, `Connection "${conn.name}" is not a ${integration} connection`);
  return conn;
}

/**
 * "Send test event" (spec/27 §5): fires a trigger's sample payload through the
 * same per-workspace fan-out a real delivery uses, marked `test: true` so run
 * history can badge it. This is how every trigger is demoable without the real
 * service - or a public URL for it to call.
 */
export async function sendTestEvent(req, res, next) {
  try {
    const { id, triggerId } = req.params;
    const manifest = IntegrationRegistry.get(id);
    const trigger = manifest?.triggers?.find((t) => t.id === triggerId);
    if (!trigger) throw new HttpError(404, 'Trigger not found');
    const conn = await connectionFor(req, id, req.body?.connectionId);

    const { triggered, skipped } = await dispatchIntegrationEvent(req.workspaceId, {
      integration: id,
      triggerId,
      connectionId: conn?._id || null,
      test: true,
      data: trigger.samplePayload ?? null,
    });
    res.status(202).json({ triggered, skipped });
  } catch (err) {
    next(err);
  }
}

/** "Check feed now" for an RSS connection: one poll, outside the schedule. */
export async function pollNow(req, res, next) {
  try {
    if (req.params.id !== 'rss') throw new HttpError(404, 'Only RSS connections are polled');
    const conn = await connectionFor(req, 'rss', req.body?.connectionId);
    if (!conn) throw new HttpError(400, 'connectionId is required');
    const result = await pollConnection(conn);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

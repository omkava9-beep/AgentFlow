import Workspace from '../models/Workspace.js';
import Connection from '../models/Connection.js';
import { IntegrationRegistry } from '../integrations/IntegrationRegistry.js';
import { InboundSignatureError } from '../integrations/inbound.js';
import { resolveConnection } from '../services/connectionService.js';
import { dispatchIntegrationEvent } from '../services/integrationEvents.js';
import { HttpError } from '../middleware/errorHandler.js';

/**
 * `POST /api/w/:slug/hooks/:integration/:inboundToken` (spec/27 §5): a real
 * provider's delivery becomes a workspace event.
 *
 * The token in the URL is the credential (like a workflow webhook's, spec/13),
 * so the lookup is by token, not by membership. Any mismatch - slug, integration
 * or token - is the same 404, so a caller can't probe which part was wrong.
 */

function parseBody(req) {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const type = String(req.headers['content-type'] || '').toLowerCase();
  const text = raw.toString('utf8');
  if (!text.trim()) return { raw, body: {} };
  if (type.includes('application/x-www-form-urlencoded')) {
    return { raw, body: Object.fromEntries(new URLSearchParams(text)) };
  }
  try {
    return { raw, body: JSON.parse(text) };
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
}

export async function receiveInbound(req, res, next) {
  try {
    const { slug, integration, inboundToken } = req.params;
    const notFound = new HttpError(404, 'Not found');

    const workspace = await Workspace.findOne({ slug: String(slug).toLowerCase() }).select('_id').lean();
    if (!workspace) throw notFound;
    const manifest = IntegrationRegistry.get(integration);
    if (!manifest?.inbound) throw notFound;
    // tenancy: capability lookup — the inbound token is the credential.
    const connection = await Connection.findOne({ workspaceId: workspace._id, integration, inboundToken: String(inboundToken) }).select('_id').lean();
    if (!connection) throw notFound;

    let resolved;
    try {
      resolved = await resolveConnection(workspace._id, connection._id, integration);
    } catch (err) {
      // Undecryptable credentials: the provider can't fix this by retrying.
      throw new HttpError(409, err.message);
    }

    const { raw, body } = parseBody(req);
    // The manifests' adapter contract (integrations/inboundUtil.js).
    const inboundReq = { headers: req.headers, rawBody: raw, body, query: req.query, connection: resolved };

    let verified;
    try {
      verified = manifest.inbound.verify ? await manifest.inbound.verify(inboundReq) : true;
    } catch (err) {
      if (err instanceof InboundSignatureError) throw new HttpError(401, err.message);
      throw err;
    }
    if (verified === false) throw new HttpError(401, 'Signature does not match');

    const parsed = await manifest.inbound.parse(inboundReq);
    if (parsed?.respond) {
      // A provider handshake answered directly (Slack's url_verification).
      return res.status(parsed.respond.status || 200).json(parsed.respond.body ?? {});
    }
    if (parsed?.challenge !== undefined) {
      return res.json({ challenge: parsed.challenge });
    }
    const known = new Set((manifest.triggers || []).map((t) => t.id));
    if (!parsed || !known.has(parsed.triggerId)) {
      // Providers retry anything that isn't 2xx, so an event we don't map is
      // acknowledged and dropped rather than refused.
      return res.status(202).json({ triggered: [], ignored: true });
    }

    const { triggered, skipped } = await dispatchIntegrationEvent(workspace._id, {
      integration,
      triggerId: parsed.triggerId,
      connectionId: connection._id,
      data: parsed.data ?? null,
      deliveryId: parsed.deliveryId || null,
    });
    res.status(202).json({ triggered, skipped });
  } catch (err) {
    next(err);
  }
}

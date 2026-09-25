import Workflow from '../models/Workflow.js';
import Connection from '../models/Connection.js';
import { HttpError } from '../middleware/errorHandler.js';
import { findInWorkspace, isValidObjectId } from '../tenancy/scoped.js';
import { generateToken } from '../utils/token.js';
import { registerSchedule, unregisterSchedule, isValidCron } from '../scheduler/index.js';
import { createAndStartRun, SKIP_REASONS } from '../services/runService.js';
import { sendQuotaExceeded } from '../services/quota.js';
import { EVENT_NAME_RE } from '../services/eventService.js';
import { env } from '../config/env.js';
import { audit } from '../services/audit.js';
import { broadcastTriggersChanged } from '../collab/hub.js';

// Trigger settings, never the webhook token: that's a capability to start runs.
const auditTrigger = (req, workflow, kind, after) => audit(req, 'trigger.updated',
  { type: 'workflow', id: workflow._id, name: workflow.name }, { after, meta: { kind } });

const webhookUrl = (token) => `${env.publicBaseUrl}/api/hooks/${token}`;

// --- schedule (spec/12) -----------------------------------------------------

export async function putSchedule(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    const { cronExpression, enabled } = req.body || {};

    if (enabled && !isValidCron(cronExpression)) {
      throw new HttpError(400, `"${cronExpression ?? ''}" is not a valid cron expression`);
    }

    workflow.schedule = { cronExpression: cronExpression || null, enabled: Boolean(enabled) };
    await workflow.save();
    // Other peers' Trigger panels refresh (spec/28); never carries the token.
    broadcastTriggersChanged(workflow);
    registerSchedule(workflow);
    await auditTrigger(req, workflow, 'schedule', { cronExpression: workflow.schedule.cronExpression, enabled: workflow.schedule.enabled });

    res.json(workflow.schedule);
  } catch (err) {
    next(err);
  }
}

export async function deleteSchedule(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    workflow.schedule = { cronExpression: null, enabled: false };
    await workflow.save();
    // Other peers' Trigger panels refresh (spec/28); never carries the token.
    broadcastTriggersChanged(workflow);
    unregisterSchedule(workflow._id);
    await auditTrigger(req, workflow, 'schedule', { cronExpression: null, enabled: false });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// --- webhook (spec/13) ------------------------------------------------------

export async function regenerateWebhook(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    const token = generateToken();
    // Regenerating enables it too: a fresh URL the caller then has to switch on
    // separately is a pointless extra step.
    workflow.webhook = { token, enabled: true };
    await workflow.save();
    // Other peers' Trigger panels refresh (spec/28); never carries the token.
    broadcastTriggersChanged(workflow);
    await audit(req, 'webhook.regenerated', { type: 'workflow', id: workflow._id, name: workflow.name }, { meta: { kind: 'webhook' } });
    res.json({ token, url: webhookUrl(token) });
  } catch (err) {
    next(err);
  }
}

export async function putWebhook(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    const { enabled } = req.body || {};
    if (enabled && !workflow.webhook?.token) {
      throw new HttpError(400, 'Generate a webhook URL before enabling it');
    }
    workflow.webhook = { token: workflow.webhook?.token || null, enabled: Boolean(enabled) };
    await workflow.save();
    // Other peers' Trigger panels refresh (spec/28); never carries the token.
    broadcastTriggersChanged(workflow);
    await auditTrigger(req, workflow, 'webhook', { enabled: workflow.webhook.enabled });
    res.json({
      enabled: workflow.webhook.enabled,
      token: workflow.webhook.token,
      url: workflow.webhook.token ? webhookUrl(workflow.webhook.token) : null,
    });
  } catch (err) {
    next(err);
  }
}

/** Unauthenticated: external callers have no JWT, so the token is the credential. */
export async function receiveWebhook(req, res, next) {
  try {
    const workflow = await Workflow.findOne({ 'webhook.token': req.params.token, 'webhook.enabled': true }); // tenancy: capability lookup
    // Same 404 whether the token never existed or was disabled/regenerated -
    // don't confirm that a token was once valid.
    if (!workflow) throw new HttpError(404, 'Not found');

    const payload = req.body && Object.keys(req.body).length ? req.body : null;
    const result = await createAndStartRun(workflow, { trigger: 'webhook', input: payload });

    if (!result.ok && result.reason === SKIP_REASONS.QUOTA_EXCEEDED) return sendQuotaExceeded(res, result);
    // spec/30 §2: webhooks run the published version, never the draft.
    if (!result.ok && result.reason === SKIP_REASONS.NOT_PUBLISHED) throw new HttpError(409, 'Workflow has no published version');
    if (!result.ok) {
      throw result.reason === SKIP_REASONS.ALREADY_RUNNING
        ? new HttpError(409, 'This workflow already has a run in progress')
        : new HttpError(400, 'Workflow must have at least a Start node before it can run');
    }

    res.status(202).json({ runId: result.runId });
  } catch (err) {
    next(err);
  }
}

// --- named event (spec/21) --------------------------------------------------

export async function putEventTrigger(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    const { eventName, enabled, connectionId = null } = req.body || {};
    const trimmed = typeof eventName === 'string' ? eventName.trim() : '';

    // A name the publish endpoint would reject can never fire, so refuse it here too.
    if (trimmed && !EVENT_NAME_RE.test(trimmed)) {
      throw new HttpError(400, 'Event names may only contain letters, digits, ".", "_", ":" and "-" (max 100)');
    }
    if (enabled && !trimmed) {
      throw new HttpError(400, 'An event name is required to enable this trigger');
    }

    // spec/26 §7: an optional filter to one connection of the integration the
    // event belongs to (`stripe.payment_failed` → a Stripe connection).
    let filterId = null;
    if (connectionId) {
      const conn = isValidObjectId(connectionId)
        ? await Connection.findOne({ _id: connectionId, workspaceId: req.workspaceId }).select('integration').lean()
        : null;
      if (!conn) throw new HttpError(400, 'Connection not found in this workspace');
      if (!trimmed.startsWith(`${conn.integration}.`)) {
        throw new HttpError(400, `A ${conn.integration} connection can only filter ${conn.integration}.* events`);
      }
      filterId = conn._id;
    }

    workflow.eventTrigger = { eventName: trimmed || null, enabled: Boolean(enabled), connectionId: filterId };
    await workflow.save();
    // Other peers' Trigger panels refresh (spec/28); never carries the token.
    broadcastTriggersChanged(workflow);
    await auditTrigger(req, workflow, 'event', { eventName: workflow.eventTrigger.eventName, enabled: workflow.eventTrigger.enabled });
    res.json(workflow.eventTrigger);
  } catch (err) {
    next(err);
  }
}

export async function deleteEventTrigger(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    workflow.eventTrigger = { eventName: null, enabled: false, connectionId: null };
    await workflow.save();
    // Other peers' Trigger panels refresh (spec/28); never carries the token.
    broadcastTriggersChanged(workflow);
    await auditTrigger(req, workflow, 'event', { eventName: null, enabled: false });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * The old global event endpoint (spec/21). Event names were one namespace across
 * every tenant, so any caller could fire anyone's subscribers. Spec/24 replaced it
 * with the per-workspace, API-key-authenticated `/api/w/:slug/events/:name`; this
 * answers 410 with a pointer rather than silently keeping the hole open.
 */
export function eventEndpointGone(req, res) {
  res.status(410).json({
    error: 'This endpoint was removed. Publish events to your workspace with an API key instead.',
    newUrl: `/api/w/<slug>/events/${req.params.eventName}`,
  });
}

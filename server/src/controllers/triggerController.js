import Workflow from '../models/Workflow.js';
import { HttpError } from '../middleware/errorHandler.js';
import { findOwned } from './workflowController.js';
import { generateToken } from '../utils/token.js';
import { registerSchedule, unregisterSchedule, isValidCron } from '../scheduler/index.js';
import { createAndStartRun, startRunForWorkflowId, SKIP_REASONS } from '../services/runService.js';
import { env } from '../config/env.js';

const webhookUrl = (token) => `${env.publicBaseUrl}/api/hooks/${token}`;

// --- schedule (spec/12) -----------------------------------------------------

export async function putSchedule(req, res, next) {
  try {
    const workflow = await findOwned(req.params.id, req.userId);
    const { cronExpression, enabled } = req.body || {};

    if (enabled && !isValidCron(cronExpression)) {
      throw new HttpError(400, `"${cronExpression ?? ''}" is not a valid cron expression`);
    }

    workflow.schedule = { cronExpression: cronExpression || null, enabled: Boolean(enabled) };
    await workflow.save();
    registerSchedule(workflow);

    res.json(workflow.schedule);
  } catch (err) {
    next(err);
  }
}

export async function deleteSchedule(req, res, next) {
  try {
    const workflow = await findOwned(req.params.id, req.userId);
    workflow.schedule = { cronExpression: null, enabled: false };
    await workflow.save();
    unregisterSchedule(workflow._id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// --- webhook (spec/13) ------------------------------------------------------

export async function regenerateWebhook(req, res, next) {
  try {
    const workflow = await findOwned(req.params.id, req.userId);
    const token = generateToken();
    // Regenerating enables it too: a fresh URL the caller then has to switch on
    // separately is a pointless extra step.
    workflow.webhook = { token, enabled: true };
    await workflow.save();
    res.json({ token, url: webhookUrl(token) });
  } catch (err) {
    next(err);
  }
}

export async function putWebhook(req, res, next) {
  try {
    const workflow = await findOwned(req.params.id, req.userId);
    const { enabled } = req.body || {};
    if (enabled && !workflow.webhook?.token) {
      throw new HttpError(400, 'Generate a webhook URL before enabling it');
    }
    workflow.webhook = { token: workflow.webhook?.token || null, enabled: Boolean(enabled) };
    await workflow.save();
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
    const workflow = await Workflow.findOne({ 'webhook.token': req.params.token, 'webhook.enabled': true });
    // Same 404 whether the token never existed or was disabled/regenerated -
    // don't confirm that a token was once valid.
    if (!workflow) throw new HttpError(404, 'Not found');

    const payload = req.body && Object.keys(req.body).length ? req.body : null;
    const result = await createAndStartRun(workflow, { trigger: 'webhook', input: payload });

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
    const workflow = await findOwned(req.params.id, req.userId);
    const { eventName, enabled } = req.body || {};
    const trimmed = typeof eventName === 'string' ? eventName.trim() : '';

    if (enabled && !trimmed) {
      throw new HttpError(400, 'An event name is required to enable this trigger');
    }

    workflow.eventTrigger = { eventName: trimmed || null, enabled: Boolean(enabled) };
    await workflow.save();
    res.json(workflow.eventTrigger);
  } catch (err) {
    next(err);
  }
}

export async function deleteEventTrigger(req, res, next) {
  try {
    const workflow = await findOwned(req.params.id, req.userId);
    workflow.eventTrigger = { eventName: null, enabled: false };
    await workflow.save();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * Fan-out dispatch, and the thing that makes an event different from a webhook:
 * a webhook token addresses one workflow, an event name addresses every workflow
 * subscribed to it.
 *
 * Unauthenticated, like the webhook endpoint. In a genuinely multi-user
 * deployment this would need namespacing per user (a publish token, or
 * `/api/events/:userToken/:eventName`) so one account can't fire another's
 * workflows; at this project's single-user scope it matches every subscriber.
 */
export async function dispatchEvent(req, res, next) {
  try {
    const eventName = req.params.eventName;
    const workflows = await Workflow.find({ 'eventTrigger.eventName': eventName, 'eventTrigger.enabled': true });
    const payload = req.body && Object.keys(req.body).length ? req.body : null;

    const triggered = [];
    const skipped = [];
    for (const workflow of workflows) {
      const result = await startRunForWorkflowId(workflow._id, { trigger: 'event', input: payload });
      if (result.ok) triggered.push(result.runId);
      else skipped.push({ workflowId: String(workflow._id), reason: result.reason });
    }

    // 202 with an empty list, never 404: the caller is a publisher, and whether
    // anyone subscribed is not its concern.
    res.status(202).json({ event: eventName, triggered, skipped });
  } catch (err) {
    next(err);
  }
}

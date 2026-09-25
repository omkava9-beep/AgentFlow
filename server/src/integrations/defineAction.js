import { env } from '../config/env.js';
import { PermanentFailure } from '../queue/errors.js';
import { classifyFailure, retryAfterMs, NetworkError, RequestTimeoutError } from '../net/safeRequest.js';
import { interpolateConfig } from './template.js';

const FIELD_TYPES = new Set(['text', 'textarea', 'number', 'select', 'boolean', 'json']);
const AUTH_TYPES = new Set(['none', 'apiKey', 'bearer', 'basic', 'webhookUrl', 'custom']);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tagged so the monitor reads it as intentional (spec/17), not as a bug. */
export class SimulatedToolFailure extends Error {}

// ------------------------------------------------------------------ manifests

function validateSchema(schema, where) {
  if (!Array.isArray(schema)) throw new Error(`${where}: configSchema must be an array`);
  const keys = new Set();
  for (const field of schema) {
    if (!field?.key || typeof field.key !== 'string') throw new Error(`${where}: every field needs a string key`);
    if (keys.has(field.key)) throw new Error(`${where}: duplicate field "${field.key}"`);
    keys.add(field.key);
    if (!FIELD_TYPES.has(field.type)) throw new Error(`${where}: field "${field.key}" has unknown type "${field.type}"`);
    if (field.type === 'select' && !Array.isArray(field.options)) throw new Error(`${where}: select "${field.key}" needs options`);
  }
}

/**
 * Normalizes one action. `sideEffect: true` forces not-cacheable no matter what
 * `cacheable` says — spec/21's rule, made structural instead of a flag someone
 * can forget. `cacheable` may also be a function of the params (http's
 * `cacheGet`).
 */
export function defineAction(spec) {
  return {
    configSchema: [],
    outputSample: null,
    ...spec,
    cacheable: spec.sideEffect ? false : (spec.cacheable ?? true),
    sideEffect: Boolean(spec.sideEffect),
  };
}

/** Validated at import, so an invalid manifest fails boot naming the integration. */
export function defineIntegration(manifest) {
  const where = `integration "${manifest?.id}"`;
  if (!manifest?.id || !/^[a-z][a-z0-9_-]*$/.test(manifest.id)) throw new Error(`${where}: invalid id`);
  if (!manifest.name) throw new Error(`${where}: missing name`);
  const auth = manifest.auth || { type: 'none', fields: [] };
  if (!AUTH_TYPES.has(auth.type)) throw new Error(`${where}: unknown auth type "${auth.type}"`);
  validateSchema(auth.fields || [], `${where} auth`);

  const actions = (manifest.actions || []).map(defineAction);
  const actionIds = new Set();
  for (const action of actions) {
    const at = `${where} action "${action.id}"`;
    if (!action.id) throw new Error(`${where}: an action is missing its id`);
    if (actionIds.has(action.id)) throw new Error(`${where}: duplicate action "${action.id}"`);
    actionIds.add(action.id);
    if (typeof action.sandbox !== 'function') throw new Error(`${at}: sandbox implementation is required`);
    if (action.live !== undefined && typeof action.live !== 'function') throw new Error(`${at}: live must be a function`);
    validateSchema(action.configSchema, at);
  }

  const triggerIds = new Set();
  for (const trigger of manifest.triggers || []) {
    if (!trigger.id || triggerIds.has(trigger.id)) throw new Error(`${where}: missing or duplicate trigger id "${trigger.id}"`);
    triggerIds.add(trigger.id);
  }

  return {
    icon: manifest.id,
    category: 'other',
    description: '',
    triggers: [],
    ...manifest,
    auth: { type: auth.type, fields: auth.fields || [] },
    actions,
  };
}

// ------------------------------------------------------------------ params

const isEmpty = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/**
 * `{{input.x}}` interpolation (spec/21), then schema defaults, required-field
 * validation and `json` parsing — done once here instead of by hand in every
 * action. Anything invalid is a PermanentFailure: it would fail identically on
 * every retry.
 */
export function prepareParams(action, rawParams, input, logs) {
  const params = interpolateConfig(rawParams || {}, input, logs);
  for (const field of action.configSchema) {
    let value = params[field.key];
    if (isEmpty(value) && field.default !== undefined) value = field.default;

    if (isEmpty(value)) {
      if (field.required) throw new PermanentFailure(`${action.name} requires "${field.label || field.key}"`);
      if (field.type === 'json') value = undefined;
    } else if (field.type === 'json' && typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch (err) {
        throw new PermanentFailure(`${action.name}: "${field.label || field.key}" is not valid JSON (${err.message})`);
      }
    } else if (field.type === 'number' && typeof value === 'string') {
      const n = Number(value);
      value = Number.isFinite(n) ? n : value;
    } else if (field.type === 'boolean' && typeof value === 'string') {
      value = value === 'true';
    }
    params[field.key] = value;
  }
  return params;
}

// ------------------------------------------------------------------ live errors

/**
 * A live response that isn't 2xx becomes a queue-vocabulary error (spec/26 §2,
 * refined by spec/27 for non-idempotent methods): permanent failures fail the
 * node in one attempt; retryable ones carry `retryAfterMs` when the service
 * sent a Retry-After, which the queue honours.
 */
export function assertOk(response, { method = 'GET', what } = {}) {
  if (response.ok) return response;
  const verdict = classifyFailure({ method, status: response.status });
  const excerpt = typeof response.body === 'string'
    ? response.body.slice(0, 200)
    : JSON.stringify(response.body ?? '').slice(0, 200);
  const label = what || `${method.toUpperCase()} ${response.url}`;

  if (verdict === 'retryable') {
    const err = new Error(`${label} returned ${response.status}: ${excerpt}`);
    err.retryable = true;
    const wait = retryAfterMs(response.headers || {});
    if (wait !== null) err.retryAfterMs = wait;
    err.status = response.status;
    throw err;
  }
  const nonIdempotent = response.status >= 500;
  throw new PermanentFailure(nonIdempotent
    ? `Not retried: ${method.toUpperCase()} is not idempotent and may have been received (${label} returned ${response.status})`
    : `${label} returned ${response.status}: ${excerpt}`);
}

/** Maps anything a live implementation throws onto the queue's two outcomes. */
function toQueueError(err, method) {
  if (err?.permanent) return err;
  if (err instanceof NetworkError || err instanceof RequestTimeoutError) {
    if (classifyFailure({ method, error: err }) === 'permanent') {
      return new PermanentFailure(`Not retried: ${method.toUpperCase()} is not idempotent and may have been received (${err.message})`);
    }
    return err;
  }
  // Anything else is a bug in the adapter or an unexpected response shape:
  // retryable up to maxAttempts (spec/26 edge cases), then failed.
  return err;
}

// ------------------------------------------------------------------ execution

/**
 * Sandbox-only mock behaviour, carried over from phase 2's withMockBehavior():
 * artificial latency and spec/17's failure injection. Live calls have real
 * latency and real failures, so neither is applied to them.
 */
async function withMockBehavior(label, mockOverrides) {
  const [minLatency, maxLatency] = mockOverrides?.latencyMs || [200, 900];
  await delay(minLatency + Math.random() * (maxLatency - minLatency));
  const failureRate = mockOverrides?.failureRate ?? env.defaultToolFailureRate;
  if (Math.random() < failureRate) {
    throw new SimulatedToolFailure(`[simulated failure] ${label} call failed`);
  }
}

/** Runs one action in the decided mode and returns its raw output. */
export async function runAction({ manifest, action, mode, ctx, mockOverrides }) {
  const label = `${manifest.id}.${action.id}`;
  if (mode === 'live') {
    const method = String(ctx.params?.method || 'POST');
    try {
      return await action.live(ctx);
    } catch (err) {
      throw toQueueError(err, method);
    }
  }
  // In-process actions (knowledge search, AI presets through AgentProvider)
  // opt out of simulated latency and failure: they're real work, not a stand-in
  // for a remote service (spec/27 §4, §7).
  if (action.mockBehavior !== false) await withMockBehavior(label, mockOverrides);
  return action.sandbox(ctx);
}

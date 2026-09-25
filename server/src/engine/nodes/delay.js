import { env } from '../../config/env.js';
import { PermanentFailure } from '../../queue/errors.js';
import { resolveValue } from '../../integrations/template.js';
import { RunCancelledError, templateScope } from './shared.js';

function waitMs(ctx) {
  const { mode = 'duration', durationMs, until } = ctx.config;
  if (mode === 'until') {
    const resolved = resolveValue(until, templateScope(ctx), []);
    const at = new Date(resolved);
    if (Number.isNaN(at.getTime())) throw new PermanentFailure(`Delay "until" is not a valid date: ${resolved || '(empty)'}`);
    return Math.max(0, at.getTime() - Date.now());
  }
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms < 0) throw new PermanentFailure('Delay duration must be a non-negative number of milliseconds');
  return ms;
}

/**
 * Waits without holding a queue slot (spec/31 §3): it's a timer in the engine,
 * raced against cancellation so a cancel wakes it immediately.
 */
export default {
  type: 'delay',
  kind: 'orchestration',
  handles: { source: ['default'], error: false },
  async execute(ctx) {
    const ms = Math.min(waitMs(ctx), env.delayMaxMs);
    if (ms > env.delayInlineMaxMs) {
      // spec/32: a long delay parks the run like an approval does - `waiting`
      // with a resumeAt, re-armed after a restart, and not counted toward the
      // run deadline.
      const resumeAt = new Date(Date.now() + ms);
      return { logs: [`[delay] parking for ${ms}ms - resumes at ${resumeAt.toISOString()}`], wait: { reason: 'delay', resumeAt } };
    }
    let timer;
    const slept = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
    const woke = await Promise.race([slept.then(() => 'done'), ctx.signal.cancelled.then(() => 'cancelled')]);
    clearTimeout(timer);
    if (woke === 'cancelled') throw new RunCancelledError();
    return { output: ctx.input, logs: [`[delay] waited ${ms}ms`] };
  },

  /** A parked delay's timer fired: pass the input through, as an inline delay does. */
  resolve(ctx) {
    return { output: ctx.input, logs: ['[delay] resumed after parking'] };
  },
};

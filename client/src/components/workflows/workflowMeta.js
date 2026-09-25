import { CalendarClock, Play, Webhook, Zap } from 'lucide-react';
import { describeCron } from '../../utils/cron';

/** One icon per way a workflow can start; "manual" is the Builder's Run button. */
export const TRIGGER_META = {
  manual: { icon: Play, label: 'Manual' },
  schedule: { icon: CalendarClock, label: 'Schedule' },
  webhook: { icon: Webhook, label: 'Webhook' },
  event: { icon: Zap, label: 'Event' },
};

/**
 * Where the workflow stands, from the list payload (spec/30): never published,
 * published with the draft ahead of it, or published and in sync.
 */
export function versionState(wf) {
  if (!wf.publishedVersion) return 'draft';
  return wf.hasUnpublishedChanges ? 'changes' : 'published';
}

export const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'published', label: 'Published' },
  { value: 'changes', label: 'Unpublished changes' },
  { value: 'draft', label: 'Draft' },
  { value: 'failing', label: 'Failing' },
];

export function matchesStatus(wf, status) {
  if (status === 'all') return true;
  if (status === 'failing') return wf.lastRun?.status === 'failed';
  return versionState(wf) === status;
}

/** 'stripe.payment_failed' → 'Stripe · payment failed', using catalogue names when known. */
function describeEvent(eventName, names) {
  if (!eventName) return 'Event';
  const [integration, ...rest] = String(eventName).split('.');
  const trigger = rest.join('.').replace(/_/g, ' ');
  if (!trigger) return eventName;
  return `${names.get(integration) || integration} · ${trigger}`;
}

/**
 * The line under a workflow's name: what starts it, in words. Several active
 * triggers show the first one; the icons next to it show all of them.
 */
export function triggerLine(wf, names = new Map()) {
  const first = wf.triggers?.[0];
  if (!first) return 'Runs manually';
  if (first.type === 'schedule') {
    const text = describeCron(first.detail);
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : `Schedule · ${first.detail}`;
  }
  if (first.type === 'event') return describeEvent(first.detail, names);
  return 'Webhook';
}

export function triggerTypes(wf) {
  return wf.triggers?.length ? wf.triggers.map((t) => t.type) : ['manual'];
}

/**
 * Integration marks worth showing: real integrations first; the built-in demo
 * tools only when nothing else is used. An agent node counts as "AI".
 */
export function displayIntegrations(wf) {
  const ids = (wf.integrations || []).filter(Boolean);
  // An event trigger's integration counts too: a flow started by Stripe's
  // payment_failed is a Stripe workflow even if no node calls Stripe.
  const fromTriggers = (wf.triggers || [])
    .filter((t) => t.type === 'event' && t.detail && String(t.detail).includes('.'))
    .map((t) => String(t.detail).split('.')[0]);
  const real = [...fromTriggers, ...ids.filter((id) => id !== 'builtin')];
  const out = [...new Set(real)];
  if ((wf.nodeTypes || []).includes('agent') && !out.includes('ai')) out.unshift('ai');
  if (!out.length && ids.includes('builtin')) out.push('builtin');
  return out;
}

export function successRate(stats) {
  const finished = (stats?.success || 0) + (stats?.failed || 0);
  if (!finished) return null;
  return Math.round(((stats.success || 0) / finished) * 100);
}

export const SORTS = [
  { value: 'updated', label: 'Last updated' },
  { value: 'name', label: 'Name' },
  { value: 'lastRun', label: 'Last run' },
  { value: 'activity', label: 'Most active' },
];

export function sortWorkflows(list, sort) {
  const time = (d) => (d ? new Date(d).getTime() : 0);
  const out = [...list];
  if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'lastRun') out.sort((a, b) => time(b.lastRun?.startedAt) - time(a.lastRun?.startedAt));
  else if (sort === 'activity') out.sort((a, b) => (b.stats7d?.total || 0) - (a.stats7d?.total || 0));
  else out.sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  return out;
}

// Notification sinks: where a flow reports, rarely what it's about. They only
// lead a row when nothing else does.
const SINKS = new Set(['slack', 'email', 'discord', 'teams', 'twilio']);

/**
 * What a workflow's row leads with - its most identifying start or first step:
 *   1. the integration its event trigger listens to (Stripe payment_failed),
 *   2. a schedule or webhook trigger (a calendar / webhook tile),
 *   3. the first tool in flow order that isn't a notification sink,
 *   4. the first sink, else a neutral workflow tile.
 * Returns { kind: 'integration', id } | { kind: 'schedule' | 'webhook' | 'workflow' }.
 */
export function leadMark(wf) {
  const eventTrigger = (wf.triggers || []).find((t) => t.type === 'event' && t.detail && String(t.detail).includes('.'));
  if (eventTrigger) return { kind: 'integration', id: String(eventTrigger.detail).split('.')[0] };
  if ((wf.triggers || []).some((t) => t.type === 'schedule')) return { kind: 'schedule' };
  if ((wf.triggers || []).some((t) => t.type === 'webhook')) return { kind: 'webhook' };
  const ordered = (wf.integrationsInOrder?.length ? wf.integrationsInOrder : wf.integrations || [])
    .filter((id) => id && id !== 'builtin');
  const first = ordered.find((id) => !SINKS.has(id)) || ordered[0];
  if (first) return { kind: 'integration', id: first };
  return { kind: 'workflow' };
}

/** Back-compat: the integration id a row leads with, or null for a trigger/neutral tile. */
export function primaryIntegration(wf) {
  const mark = leadMark(wf);
  return mark.kind === 'integration' ? mark.id : null;
}

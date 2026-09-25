import Workflow from '../models/Workflow.js';
import Connection from '../models/Connection.js';
import { IntegrationRegistry } from '../integrations/IntegrationRegistry.js';
import { decideMode } from '../integrations/mode.js';
import { fetchFeed } from '../integrations/rssFeed.js';
import { createSandboxStore } from '../integrations/sandboxStore.js';
import { dispatchIntegrationEvent } from '../services/integrationEvents.js';

/**
 * `rss.new_item`, the one poll-based trigger (spec/27 §6).
 *
 * Rather than one cron job per connection that has to be kept in step with
 * every trigger and connection edit, a single in-process ticker reconciles once
 * a minute: it works out which RSS connections have at least one enabled
 * subscriber, and polls each one that is due. Nothing to re-register on boot
 * beyond starting the ticker, and nothing can drift.
 *
 * Seen items are remembered per connection in the `rss.seen` sandbox
 * collection, so a restart doesn't re-fire the backlog. The first poll of a
 * connection only records what it sees: subscribing must not fire every item
 * already in the feed.
 */

const EVENT = 'rss.new_item';
const TICK_MS = 60_000;
const MIN_POLL_MINUTES = 5;
const INIT_MARKER = '__initialized__';

const lastPolled = new Map(); // connectionId -> epoch ms
let timer = null;

const pollMinutesOf = (conn) => Math.max(MIN_POLL_MINUTES, Number(conn.config?.pollMinutes) || 15);

/** RSS connections with at least one enabled `rss.new_item` subscriber. */
async function subscribedConnections() {
  const subscribers = await Workflow.find({ 'eventTrigger.eventName': EVENT, 'eventTrigger.enabled': true })
    .select('workspaceId eventTrigger.connectionId').lean();
  if (!subscribers.length) return [];

  const specific = new Set();
  const anyInWorkspace = new Set();
  for (const wf of subscribers) {
    if (wf.eventTrigger?.connectionId) specific.add(String(wf.eventTrigger.connectionId));
    else anyInWorkspace.add(String(wf.workspaceId));
  }
  return Connection.find({
    integration: 'rss',
    $or: [{ _id: { $in: [...specific] } }, { workspaceId: { $in: [...anyInWorkspace] } }],
  });
}

/**
 * Polls one RSS connection now and dispatches one event per new item.
 * → `{ fetched, fresh, triggered, firstPoll }` or `{ skipped: reason }`.
 */
export async function pollConnection(conn) {
  const manifest = IntegrationRegistry.get('rss');
  const action = IntegrationRegistry.getAction('rss', 'read_feed');
  // Polling is outbound traffic: it follows the same live rule as the action,
  // so INTEGRATIONS_LIVE=false or a sandbox-mode connection never fetches.
  if (decideMode({ manifest, action, connection: conn }) !== 'live') return { skipped: 'sandbox' };
  const feedUrl = conn.config?.feedUrl;
  if (!feedUrl) return { skipped: 'no feed URL' };

  lastPolled.set(String(conn._id), Date.now());
  let feed;
  try {
    feed = await fetchFeed(feedUrl);
  } catch (err) {
    await Connection.updateOne({ _id: conn._id }, { $set: { lastError: `Feed poll failed: ${err.message}` } });
    return { skipped: 'fetch failed', error: err.message };
  }

  const store = createSandboxStore({ workspaceId: conn.workspaceId, integration: 'rss', runId: null });
  const connectionId = String(conn._id);
  const firstPoll = !(await store.count('seen', { connectionId }));

  const fresh = [];
  for (const item of feed.items) {
    const key = item.guid || item.link;
    if (!key) continue;
    if (await store.findOne('seen', { connectionId, key })) continue;
    await store.insert('seen', { connectionId, key });
    fresh.push(item);
  }
  if (firstPoll) {
    // Marks the connection as initialised even when the feed was empty.
    await store.insert('seen', { connectionId, key: INIT_MARKER });
    return { fetched: feed.items.length, fresh: 0, triggered: [], firstPoll: true };
  }

  const triggered = [];
  // Feeds list newest first; fire oldest first so runs happen in publication order.
  for (const item of fresh.reverse()) {
    const result = await dispatchIntegrationEvent(conn.workspaceId, {
      integration: 'rss',
      triggerId: 'new_item',
      connectionId: conn._id,
      data: { ...item, feedUrl },
      deliveryId: item.guid || null,
    });
    triggered.push(...result.triggered);
  }
  return { fetched: feed.items.length, fresh: fresh.length, triggered, firstPoll: false };
}

async function tick() {
  let conns = [];
  try {
    conns = await subscribedConnections();
  } catch (err) {
    console.error('[rss] reconcile failed:', err.message);
    return;
  }
  const now = Date.now();
  for (const conn of conns) {
    const due = (lastPolled.get(String(conn._id)) || 0) + pollMinutesOf(conn) * 60_000 <= now;
    if (!due) continue;
    try {
      const result = await pollConnection(conn);
      if (result.triggered?.length) console.log(`[rss] ${conn._id} -> ${result.triggered.length} new item run(s)`);
    } catch (err) {
      console.error(`[rss] poll of ${conn._id} failed:`, err.message);
    }
  }
}

/** Started on boot, like the cron registry (spec/12); in-process and single-instance. */
export function bootstrapRssPollers() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  // First reconcile shortly after boot, not a full minute later.
  setTimeout(tick, 5_000).unref?.();
  console.log('[rss] poll ticker started');
}

/** Which RSS connections this process has polled, and when (status page, spec/36 §7). */
export function rssPollState() {
  return { running: Boolean(timer), lastPolled: Object.fromEntries([...lastPolled.entries()].map(([id, at]) => [id, new Date(at).toISOString()])) };
}

export function stopRssPollers() {
  if (timer) clearInterval(timer);
  timer = null;
}

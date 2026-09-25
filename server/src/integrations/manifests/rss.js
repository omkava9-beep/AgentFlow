import { defineIntegration } from '../defineAction.js';
import { fetchFeed } from '../rssFeed.js';

const clampLimit = (n) => Math.max(1, Math.min(50, Number(n) || 10));

/** A small, stable fixture so sandbox runs read like a real feed. */
function sandboxFeed(url) {
  let host = 'example.com';
  try {
    host = new URL(url).hostname || host;
  } catch {
    // not a URL - keep the placeholder host
  }
  const day = 24 * 60 * 60 * 1000;
  return {
    title: `${host} (sandbox feed)`,
    items: [
      { guid: `${host}-3`, title: 'Release 3.2 ships with faster builds', link: `https://${host}/posts/3`, published: new Date(Date.now() - day).toUTCString(), summary: 'Build times drop by a third across the board.' },
      { guid: `${host}-2`, title: 'Incident report: queue backlog', link: `https://${host}/posts/2`, published: new Date(Date.now() - 2 * day).toUTCString(), summary: 'A stuck consumer delayed jobs for 40 minutes.' },
      { guid: `${host}-1`, title: 'Welcome to the blog', link: `https://${host}/posts/1`, published: new Date(Date.now() - 5 * day).toUTCString(), summary: 'What we plan to write about.' },
    ],
  };
}

export default defineIntegration({
  id: 'rss',
  name: 'RSS',
  icon: 'rss',
  category: 'web',
  description: 'Read RSS and Atom feeds, and start workflows when new items appear.',
  auth: {
    type: 'none',
    // Non-secret settings for the poll trigger (spec/27 §6), kept on the
    // connection so one feed can be shared by several workflows.
    fields: [
      { key: 'feedUrl', label: 'Feed URL', type: 'text', placeholder: 'https://example.com/feed.xml' },
      { key: 'pollMinutes', label: 'Poll every (minutes, min 5)', type: 'number', default: 15 },
    ],
  },
  actions: [
    {
      id: 'read_feed',
      name: 'Read feed',
      description: 'Fetch a feed and return its latest items.',
      cacheable: true,
      configSchema: [
        { key: 'url', label: 'Feed URL', type: 'text', placeholder: "defaults to the connection's feed URL" },
        { key: 'limit', label: 'Items', type: 'number', default: 10 },
      ],
      outputSample: { title: 'Example blog', items: [{ title: 'Hello', link: 'https://example.com/1', published: 'Tue, 24 Sep 2026 10:00:00 GMT', summary: '…' }] },
      sandbox: async ({ params, connection, logs }) => {
        const url = params.url || connection?.config?.feedUrl || 'https://example.com/feed.xml';
        logs.push(`[rss] sandbox feed for ${url} (nothing was fetched)`);
        const feed = sandboxFeed(url);
        return { title: feed.title, items: feed.items.slice(0, clampLimit(params.limit)) };
      },
      live: async ({ params, connection, http, logs }) => {
        const url = params.url || connection?.config?.feedUrl;
        const feed = await fetchFeed(url, { request: http });
        logs.push(`[rss] fetched ${feed.items.length} item(s) from ${url}`);
        return { title: feed.title, items: feed.items.slice(0, clampLimit(params.limit)) };
      },
    },
  ],
  triggers: [
    {
      id: 'new_item',
      name: 'New feed item',
      description: 'A new item appeared in the connected feed (polled).',
      samplePayload: { title: 'Release 3.2 ships with faster builds', link: 'https://example.com/posts/3', published: 'Tue, 24 Sep 2026 10:00:00 GMT', summary: 'Build times drop by a third.', feedUrl: 'https://example.com/feed.xml' },
    },
  ],
});

import { XMLParser } from 'fast-xml-parser';
import { safeRequest } from '../net/safeRequest.js';
import { assertOk } from './defineAction.js';
import { PermanentFailure } from '../queue/errors.js';

/**
 * Feed fetching and parsing, shared by the `rss.read_feed` action and the poll
 * trigger (spec/27 §6). RSS 2.0 and Atom both normalise to
 * `{ title, items: [{ guid, title, link, published, summary }] }`.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // A feed with one item still gives an array.
  isArray: (name) => ['item', 'entry', 'link'].includes(name),
});

const text = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return String(value['#text'] ?? '');
  return String(value);
};

const clip = (s, n = 400) => {
  const plain = text(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > n ? `${plain.slice(0, n)}…` : plain;
};

function atomLink(links) {
  const list = Array.isArray(links) ? links : [links];
  const alt = list.find((l) => !l?.['@_rel'] || l['@_rel'] === 'alternate') || list[0];
  return typeof alt === 'string' ? alt : alt?.['@_href'] || '';
}

export function parseFeed(xml) {
  let doc;
  try {
    doc = parser.parse(String(xml || ''));
  } catch (err) {
    throw new PermanentFailure(`Feed is not valid XML (${err.message})`);
  }

  if (doc?.rss?.channel) {
    const channel = doc.rss.channel;
    return {
      title: text(channel.title),
      items: (channel.item || []).map((item) => {
        const link = text(Array.isArray(item.link) ? item.link[0] : item.link);
        return {
          guid: text(item.guid) || link || text(item.title),
          title: text(item.title),
          link,
          published: text(item.pubDate) || null,
          summary: clip(item.description),
        };
      }),
    };
  }

  if (doc?.feed) {
    const feed = doc.feed;
    return {
      title: text(feed.title),
      items: (feed.entry || []).map((entry) => {
        const link = atomLink(entry.link);
        return {
          guid: text(entry.id) || link,
          title: text(entry.title),
          link,
          published: text(entry.published || entry.updated) || null,
          summary: clip(entry.summary || entry.content),
        };
      }),
    };
  }

  throw new PermanentFailure('Not an RSS or Atom feed');
}

/** Fetches through the one outbound client (CLAUDE.md), then parses. */
export async function fetchFeed(url, { request = safeRequest } = {}) {
  if (!url) throw new PermanentFailure('A feed URL is required');
  const response = await request({
    url,
    method: 'GET',
    headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5' },
  });
  assertOk(response, { method: 'GET', what: 'Feed' });
  const body = typeof response.body === 'string' ? response.body : response.text;
  return parseFeed(body);
}

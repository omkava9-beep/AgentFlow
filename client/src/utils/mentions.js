/**
 * Mentions travel as `{{@<userId>}}` tokens (spec/29 §3). The composer shows
 * people's names while you type; tokens are only produced on send, for names
 * that were actually picked from the autocomplete - so typing "@bob" by hand
 * stays plain text and never notifies anyone.
 */
export const MENTION_TOKEN = /\{\{@([a-f0-9]{24})\}\}/g;

/** Composer text + picked members → the body the server stores. */
export function encodeMentions(text, picked) {
  let body = text;
  // Longest names first, so "@Ann Lee" isn't eaten by a pick called "@Ann".
  const sorted = [...picked].sort((a, b) => b.name.length - a.name.length);
  for (const { id, name } of sorted) {
    body = body.split(`@${name}`).join(`{{@${id}}}`);
  }
  return body;
}

/** Stored body → composer text + the picks it contains (for editing your own comment). */
export function decodeMentions(body, mentions = []) {
  const byId = new Map(mentions.filter(Boolean).map((m) => [m.id, m]));
  const picked = [];
  const text = body.replace(MENTION_TOKEN, (_, id) => {
    const person = byId.get(id);
    if (!person) return '@someone';
    if (!picked.some((p) => p.id === id)) picked.push({ id, name: person.name });
    return `@${person.name}`;
  });
  return { text, picked };
}

/** Splits a stored body into text and mention parts for rendering. */
export function mentionParts(body, mentions = []) {
  const byId = new Map(mentions.filter(Boolean).map((m) => [m.id, m]));
  const parts = [];
  let last = 0;
  for (const match of body.matchAll(MENTION_TOKEN)) {
    if (match.index > last) parts.push({ text: body.slice(last, match.index) });
    const person = byId.get(match[1]);
    parts.push(person ? { mention: person } : { text: '@someone' });
    last = match.index + match[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

/** The `@query` being typed right before the caret, or null. */
export function activeMentionQuery(text, caret) {
  const before = text.slice(0, caret);
  const match = before.match(/(^|\s)@([^\s@]{0,30})$/);
  return match ? { query: match[2], start: caret - match[2].length - 1 } : null;
}

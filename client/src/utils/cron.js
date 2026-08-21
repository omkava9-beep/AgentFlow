/**
 * A small cron parser for the Builder's schedule panel (spec/12) — validation, a
 * human-readable description, and the next fire time.
 *
 * Deliberately dependency-free rather than pulling in cronstrue + cron-parser for
 * one panel. It covers standard 5-field syntax (`*`, `a`, `a-b`, `a,b`, `*` / `a-b`
 * with `/n` steps), which is exactly what spec/12 scopes in. `node-cron` also
 * accepts a 6-field form with seconds; the server allows it, but sub-minute
 * schedules are an explicit non-goal, so here they're described plainly and no
 * next-run is computed.
 */

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dayOfWeek', min: 0, max: 6 },
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parseField(token, { min, max }) {
  const values = new Set();

  for (const part of token.split(',')) {
    if (!part) return null;
    const [range, stepRaw] = part.split('/');
    if (stepRaw !== undefined && !/^\d+$/.test(stepRaw)) return null;
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (step < 1) return null;

    let from;
    let to;
    if (range === '*') {
      from = min;
      to = max;
    } else if (/^\d+$/.test(range)) {
      from = Number(range);
      to = stepRaw === undefined ? from : max;
    } else if (/^\d+-\d+$/.test(range)) {
      [from, to] = range.split('-').map(Number);
    } else {
      return null;
    }

    if (from < min || to > max || from > to) return null;
    for (let v = from; v <= to; v += step) values.add(v);
  }

  return values.size ? values : null;
}

export function parseCron(expression) {
  const tokens = String(expression || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== 5 && tokens.length !== 6) {
    return { valid: false, error: 'A cron expression needs 5 fields (minute hour day month weekday).' };
  }

  const hasSeconds = tokens.length === 6;
  const [secondsToken, ...rest] = hasSeconds ? tokens : [null, ...tokens];
  if (hasSeconds && !parseField(secondsToken, { min: 0, max: 59 })) {
    return { valid: false, error: 'Invalid seconds field.' };
  }

  const parsed = {};
  for (let i = 0; i < FIELDS.length; i++) {
    const values = parseField(rest[i], FIELDS[i]);
    if (!values) return { valid: false, error: `Invalid ${FIELDS[i].name} field: "${rest[i]}".` };
    parsed[FIELDS[i].name] = values;
  }

  return { valid: true, hasSeconds, secondsToken, fields: parsed, tokens: rest };
}

const isFull = (set, { min, max }) => set.size === max - min + 1;
const pad = (n) => String(n).padStart(2, '0');
const list = (items) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

export function describeCron(expression) {
  const parsed = parseCron(expression);
  if (!parsed.valid) return null;

  const { minute, hour, dayOfMonth, month, dayOfWeek } = parsed.fields;
  const [minuteToken, hourToken] = parsed.tokens;
  const everyMinute = isFull(minute, FIELDS[0]);
  const everyHour = isFull(hour, FIELDS[1]);
  const everyDom = isFull(dayOfMonth, FIELDS[2]);
  const everyMonth = isFull(month, FIELDS[3]);
  const everyDow = isFull(dayOfWeek, FIELDS[4]);

  // A sub-minute expression is *about* its seconds field, so describe that rather
  // than reporting "every minute" for something that fires every two seconds.
  if (parsed.hasSeconds && everyMinute && everyHour && everyDom && everyMonth && everyDow) {
    const t = parsed.secondsToken;
    if (t === '*') return 'every second';
    if (/^\*\/\d+$/.test(t)) return `every ${t.split('/')[1]} seconds`;
  }

  const parts = [];
  let isTimeOfDay = false;

  if (everyMinute && everyHour) {
    parts.push('every minute');
  } else if (/^\*\/\d+$/.test(minuteToken) && everyHour) {
    parts.push(`every ${minuteToken.split('/')[1]} minutes`);
  } else if (minute.size === 1 && everyHour) {
    parts.push(`hourly at :${pad([...minute][0])}`);
  } else if (minute.size === 1 && hour.size === 1) {
    parts.push(`at ${pad([...hour][0])}:${pad([...minute][0])}`);
    isTimeOfDay = true;
  } else if (minute.size === 1 && /^\*\/\d+$/.test(hourToken)) {
    parts.push(`every ${hourToken.split('/')[1]} hours at :${pad([...minute][0])}`);
  } else {
    parts.push(`at minute ${list([...minute].map(String))} of hour ${list([...hour].map(String))}`);
  }

  if (!everyDow) parts.push(`on ${list([...dayOfWeek].map((d) => DAYS[d]))}`);
  if (!everyDom) parts.push(`on day ${list([...dayOfMonth].map(String))} of the month`);
  if (!everyMonth) parts.push(`in ${list([...month].map((m) => MONTHS[m - 1]))}`);

  // "every day" only clarifies a specific time-of-day; on "hourly at :30" or
  // "every 5 minutes" it's noise.
  if (isTimeOfDay && everyDow && everyDom && everyMonth) parts.push('every day');
  if (parsed.hasSeconds) parts.push('(includes a seconds field)');

  return parts.join(' ');
}

const MAX_LOOKAHEAD_MINUTES = 400 * 24 * 60;

/** Next fire time, or null for a sub-minute expression / nothing within ~400 days. */
export function nextRun(expression, from = new Date()) {
  const parsed = parseCron(expression);
  if (!parsed.valid || parsed.hasSeconds) return null;

  const { minute, hour, dayOfMonth, month, dayOfWeek } = parsed.fields;
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let i = 0; i < MAX_LOOKAHEAD_MINUTES; i++) {
    // Standard cron treats day-of-month and day-of-week as a union when both are
    // restricted, not an intersection.
    const domRestricted = !isFull(dayOfMonth, FIELDS[2]);
    const dowRestricted = !isFull(dayOfWeek, FIELDS[4]);
    const domOk = dayOfMonth.has(cursor.getDate());
    const dowOk = dayOfWeek.has(cursor.getDay());
    const dayOk = domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;

    if (minute.has(cursor.getMinutes()) && hour.has(cursor.getHours()) && month.has(cursor.getMonth() + 1) && dayOk) {
      return cursor;
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return null;
}

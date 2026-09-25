import { defineIntegration, assertOk } from '../defineAction.js';
import { PermanentFailure } from '../../queue/errors.js';
import { hmacHex, safeEqualHex } from '../inboundUtil.js';

const API = 'https://api.github.com';
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** `owner/name`, and nothing that could walk out of the /repos/ path. */
function repoOf(value) {
  const repo = String(value || '').trim();
  if (!REPO_RE.test(repo) || repo.split('/').some((part) => part === '.' || part === '..')) {
    throw new PermanentFailure(`"${repo}" isn't a GitHub repository (expected owner/name)`);
  }
  return repo;
}

/**
 * Live calls go to api.github.com and nowhere else (spec/27 §4). The path is
 * resolved against the API origin and the result re-checked, so an absolute URL
 * or a protocol-relative path can't redirect the token to another host.
 */
export function githubApiUrl(path) {
  const url = new URL(path, API);
  if (url.origin !== API) throw new PermanentFailure(`GitHub calls are limited to ${API}`);
  return url.toString();
}

function headersFor(connection) {
  const token = connection?.credentials?.token;
  if (!token) throw new PermanentFailure('GitHub connection has no personal access token');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * GitHub signals rate limiting with 403 + x-ratelimit-remaining: 0 (or 429).
 * Retry only when the wait is short; otherwise fail now with the reset time
 * rather than burning attempts against a closed door.
 */
function assertGithubOk(response, method) {
  const limited = response.status === 429 || (response.status === 403 && response.headers?.['x-ratelimit-remaining'] === '0');
  if (limited) {
    const retryAfter = Number(response.headers?.['retry-after']);
    const reset = Number(response.headers?.['x-ratelimit-reset']);
    const waitMs = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000
      : Number.isFinite(reset) ? Math.max(0, reset * 1000 - Date.now()) : null;
    if (waitMs !== null && waitMs <= 30_000) {
      const err = new Error(`GitHub rate limit, retrying in ${Math.ceil(waitMs / 1000)}s`);
      err.retryAfterMs = waitMs;
      throw err;
    }
    const until = Number.isFinite(reset) ? new Date(reset * 1000).toISOString() : 'later';
    throw new PermanentFailure(`GitHub rate limited until ${until}`);
  }
  return assertOk(response, { method, what: `GitHub ${method}` });
}

async function call({ http, connection, method, path, body }) {
  const response = await http({ url: githubApiUrl(path), method, headers: headersFor(connection), body });
  assertGithubOk(response, method);
  return response.body;
}

// ------------------------------------------------------------------ sandbox

const FIXTURE_ISSUES = [
  { title: 'Checkout button does nothing on Safari 17', labels: ['bug', 'checkout'], author: 'maya-dev' },
  { title: 'Add dark mode to the account settings page', labels: ['enhancement'], author: 'jonas' },
  { title: 'Order confirmation email shows the wrong currency', labels: ['bug', 'email'], author: 'priya-s' },
];

const issueUrl = (repo, number) => `https://github.com/${repo}/issues/${number}`;

/** First touch of a repo seeds it, so a fresh workspace's list is never empty. */
async function ensureRepo(sandbox, repo) {
  await sandbox.seedOnce(`repo:${repo}`, 'repos', [{
    fullName: repo,
    description: `Sandbox copy of ${repo}`,
    stars: 128,
    defaultBranch: 'main',
    private: false,
    url: `https://github.com/${repo}`,
  }]);
  await sandbox.seedOnce(`issues:${repo}`, 'issues', FIXTURE_ISSUES.map((fixture, i) => ({
    repo,
    number: i + 1,
    title: fixture.title,
    body: '',
    labels: fixture.labels,
    state: 'open',
    comments: 0,
    author: fixture.author,
    url: issueUrl(repo, i + 1),
  })));
}

const presentIssue = (issue) => ({ number: issue.number, title: issue.title, state: issue.state, labels: issue.labels || [], comments: issue.comments || 0, url: issue.url });

function labelsOf(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map(String);
  const text = String(value).trim();
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* fall through to the comma list */ }
  }
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

// ------------------------------------------------------------------ inbound

function inboundData(body) {
  const item = body.issue || body.pull_request || {};
  return {
    repo: body.repository?.full_name || null,
    number: item.number ?? null,
    title: item.title || '',
    body: item.body || '',
    url: item.html_url || null,
    author: item.user?.login || null,
  };
}

export default defineIntegration({
  id: 'github',
  name: 'GitHub',
  icon: 'github',
  category: 'developer',
  description: 'Open issues, comment, and read repositories. Live through api.github.com.',
  auth: {
    type: 'bearer',
    fields: [
      { key: 'token', label: 'Personal access token', type: 'text', required: true, secret: true, placeholder: 'github_pat_…' },
      { key: 'webhookSecret', label: 'Webhook secret (optional)', type: 'text', secret: true },
    ],
  },
  test: async ({ connection, http }) => {
    const user = await call({ http, connection, method: 'GET', path: '/user' });
    return { ok: true, message: `Authenticated as ${user?.login || 'unknown user'}` };
  },
  actions: [
    {
      id: 'create_issue',
      name: 'Create issue',
      sideEffect: true,
      configSchema: [
        { key: 'repo', label: 'Repository', type: 'text', required: true, placeholder: 'acme/web' },
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'body', label: 'Body', type: 'textarea', placeholder: 'Supports {{input.field}}' },
        { key: 'labels', label: 'Labels (JSON array or comma list)', type: 'text', placeholder: 'bug, triage' },
      ],
      outputSample: { number: 4, url: 'https://github.com/acme/web/issues/4', state: 'open', title: 'Payment failed for order 1042' },
      sandbox: async ({ params, sandbox, logs }) => {
        const repo = repoOf(params.repo);
        await ensureRepo(sandbox, repo);
        const number = await sandbox.nextNumber(`issues:${repo}`, { after: FIXTURE_ISSUES.length });
        const issue = { repo, number, title: params.title, body: params.body || '', labels: labelsOf(params.labels), state: 'open', comments: 0, author: 'agentflow[bot]', url: issueUrl(repo, number) };
        await sandbox.insert('issues', issue);
        logs.push(`[github] sandbox issue ${repo}#${number} opened (nothing was sent to GitHub)`);
        return { number, url: issue.url, state: 'open', title: issue.title };
      },
      live: async ({ params, connection, http, logs }) => {
        const repo = repoOf(params.repo);
        const created = await call({ http, connection, method: 'POST', path: `/repos/${repo}/issues`, body: { title: params.title, body: params.body || '', labels: labelsOf(params.labels) } });
        logs.push(`[github] opened ${repo}#${created.number}`);
        return { number: created.number, url: created.html_url, state: created.state, title: created.title };
      },
    },
    {
      id: 'comment',
      name: 'Comment on issue',
      sideEffect: true,
      configSchema: [
        { key: 'repo', label: 'Repository', type: 'text', required: true, placeholder: 'acme/web' },
        { key: 'number', label: 'Issue number', type: 'number', required: true },
        { key: 'body', label: 'Comment', type: 'textarea', required: true },
      ],
      outputSample: { id: 2011223344, number: 4, url: 'https://github.com/acme/web/issues/4#issuecomment-2011223344' },
      sandbox: async ({ params, sandbox }) => {
        const repo = repoOf(params.repo);
        await ensureRepo(sandbox, repo);
        const number = Number(params.number);
        const issue = await sandbox.findOne('issues', { repo, number });
        if (!issue) throw new PermanentFailure(`Issue #${number} not found in ${repo}`);
        const id = await sandbox.nextNumber('comments', { after: 2011223300 });
        await sandbox.insert('comments', { repo, number, id, body: params.body, author: 'agentflow[bot]' });
        await sandbox.update('issues', issue.recordId, { comments: (issue.comments || 0) + 1 });
        return { id, number, url: `${issue.url}#issuecomment-${id}` };
      },
      live: async ({ params, connection, http }) => {
        const repo = repoOf(params.repo);
        const created = await call({ http, connection, method: 'POST', path: `/repos/${repo}/issues/${Number(params.number)}/comments`, body: { body: params.body } });
        return { id: created.id, number: Number(params.number), url: created.html_url };
      },
    },
    {
      id: 'list_issues',
      name: 'List issues',
      cacheable: true,
      configSchema: [
        { key: 'repo', label: 'Repository', type: 'text', required: true, placeholder: 'acme/web' },
        {
          key: 'state', label: 'State', type: 'select', default: 'open',
          options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' }],
        },
      ],
      outputSample: { repo: 'acme/web', count: 1, issues: [{ number: 1, title: 'Checkout button does nothing on Safari 17', state: 'open', labels: ['bug'], comments: 0, url: 'https://github.com/acme/web/issues/1' }] },
      sandbox: async ({ params, sandbox }) => {
        const repo = repoOf(params.repo);
        await ensureRepo(sandbox, repo);
        const filter = params.state && params.state !== 'all' ? { repo, state: params.state } : { repo };
        const issues = (await sandbox.find('issues', filter, { limit: 100 })).sort((a, b) => b.number - a.number).map(presentIssue);
        return { repo, count: issues.length, issues };
      },
      live: async ({ params, connection, http }) => {
        const repo = repoOf(params.repo);
        const state = ['open', 'closed', 'all'].includes(params.state) ? params.state : 'open';
        const items = await call({ http, connection, method: 'GET', path: `/repos/${repo}/issues?state=${state}&per_page=30` });
        // The issues endpoint also returns pull requests; they aren't issues here.
        const issues = (Array.isArray(items) ? items : []).filter((i) => !i.pull_request).map((i) => ({
          number: i.number, title: i.title, state: i.state, labels: (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name)), comments: i.comments, url: i.html_url,
        }));
        return { repo, count: issues.length, issues };
      },
    },
    {
      id: 'get_repo',
      name: 'Get repository',
      cacheable: true,
      configSchema: [
        { key: 'repo', label: 'Repository', type: 'text', required: true, placeholder: 'acme/web' },
      ],
      outputSample: { fullName: 'acme/web', description: 'Storefront', stars: 128, openIssues: 3, defaultBranch: 'main', url: 'https://github.com/acme/web' },
      sandbox: async ({ params, sandbox }) => {
        const repo = repoOf(params.repo);
        await ensureRepo(sandbox, repo);
        const record = await sandbox.findOne('repos', { fullName: repo });
        const openIssues = await sandbox.count('issues', { repo, state: 'open' });
        return { fullName: repo, description: record?.description || '', stars: record?.stars ?? 0, openIssues, defaultBranch: record?.defaultBranch || 'main', url: `https://github.com/${repo}` };
      },
      live: async ({ params, connection, http }) => {
        const repo = repoOf(params.repo);
        const r = await call({ http, connection, method: 'GET', path: `/repos/${repo}` });
        return { fullName: r.full_name, description: r.description || '', stars: r.stargazers_count, openIssues: r.open_issues_count, defaultBranch: r.default_branch, url: r.html_url };
      },
    },
  ],
  triggers: [
    {
      id: 'issue_opened',
      name: 'Issue opened',
      description: 'A new issue was opened in a repository.',
      samplePayload: { repo: 'acme/web', number: 42, title: 'Payments failing for EU cards', body: 'Seeing 402s since 09:00.', url: 'https://github.com/acme/web/issues/42', author: 'maya-dev' },
    },
    {
      id: 'pr_opened',
      name: 'Pull request opened',
      description: 'A pull request was opened.',
      samplePayload: { repo: 'acme/web', number: 43, title: 'Fix EU card 3DS flow', body: 'Closes #42', url: 'https://github.com/acme/web/pull/43', author: 'jonas' },
    },
  ],
  inbound: {
    // X-Hub-Signature-256 is an HMAC over the exact bytes GitHub sent.
    verify: ({ headers, rawBody, connection }) => {
      const secret = connection?.credentials?.webhookSecret;
      if (!secret) return true;
      const given = String(headers['x-hub-signature-256'] || '').replace(/^sha256=/, '');
      return safeEqualHex(given, hmacHex(secret, rawBody ?? Buffer.alloc(0)));
    },
    parse: ({ headers, body }) => {
      const event = headers['x-github-event'];
      const deliveryId = headers['x-github-delivery'] || undefined;
      if (event === 'issues' && body?.action === 'opened') return { triggerId: 'issue_opened', data: inboundData(body), deliveryId };
      if (event === 'pull_request' && body?.action === 'opened') return { triggerId: 'pr_opened', data: inboundData(body), deliveryId };
      return null;
    },
  },
});

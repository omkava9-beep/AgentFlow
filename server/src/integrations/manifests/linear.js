import { defineIntegration } from '../defineAction.js';
import { PermanentFailure } from '../../queue/errors.js';
import { genericInbound } from '../inboundUtil.js';

const PRIORITIES = [
  { value: '0', label: 'No priority' }, { value: '1', label: 'Urgent' }, { value: '2', label: 'High' },
  { value: '3', label: 'Medium' }, { value: '4', label: 'Low' },
];

export default defineIntegration({
  id: 'linear',
  name: 'Linear',
  icon: 'linear',
  category: 'developer',
  description: 'Create issues in a Linear team (sandbox).',
  auth: {
    type: 'apiKey',
    fields: [
      { key: 'apiKey', label: 'API key', type: 'text', required: true, secret: true, placeholder: 'lin_api_…' },
      { key: 'workspace', label: 'Workspace URL key', type: 'text', default: 'acme' },
    ],
  },
  actions: [
    {
      id: 'create_issue',
      name: 'Create issue',
      sideEffect: true,
      configSchema: [
        { key: 'team', label: 'Team key', type: 'text', required: true, default: 'ENG' },
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'priority', label: 'Priority', type: 'select', default: '3', options: PRIORITIES },
      ],
      outputSample: { identifier: 'ENG-128', url: 'https://linear.app/acme/issue/ENG-128', title: 'Investigate slow dashboard', priority: 3 },
      sandbox: async ({ params, connection, sandbox }) => {
        const team = String(params.team || 'ENG').trim().toUpperCase();
        if (!/^[A-Z][A-Z0-9]{0,6}$/.test(team)) throw new PermanentFailure(`"${team}" isn't a Linear team key`);
        const n = await sandbox.nextNumber(`issues:${team}`, { after: 127 });
        const identifier = `${team}-${n}`;
        const url = `https://linear.app/${connection?.config?.workspace || 'acme'}/issue/${identifier}`;
        const priority = Number(params.priority ?? 3);
        await sandbox.insert('issues', { identifier, team, title: params.title, priority, state: 'Todo', url });
        return { identifier, url, title: params.title, priority };
      },
    },
  ],
  triggers: [
    {
      id: 'issue_created',
      name: 'Issue created',
      description: 'A new issue was created in a team.',
      samplePayload: { identifier: 'ENG-131', team: 'ENG', title: 'API latency spike on /orders', priority: 1 },
    },
  ],
  inbound: genericInbound(['issue_created']),
});

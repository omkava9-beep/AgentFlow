import { useMemo, useState } from 'react';
import { Plug, Search } from 'lucide-react';
import { Dialog, Input, IntegrationLogo, Badge, EmptyState } from './ui/index';
import { groupByCategory } from '../utils/integrationCatalog';

/** Step one of "New connection": which integration it's for. */
export default function IntegrationPickerDialog({ catalog, onPick, onClose }) {
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => groupByCategory(catalog || [], filter), [catalog, filter]);

  return (
    <Dialog open onClose={onClose} title="New connection" description="Pick the service this connection stores credentials for." icon={Plug} size="lg" testId="integration-picker">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <Input autoFocus placeholder="Search integrations…" value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-8" aria-label="Search integrations" />
      </div>
      <div className="mt-4 max-h-[52vh] space-y-5 overflow-y-auto pr-1">
        {groups.map((group) => (
          <section key={group.label}>
            <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-subtle">{group.label}</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.items.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => onPick(i)}
                  className="flex items-center gap-3 rounded-card border border-default bg-surface p-2.5 text-left transition-colors hover:border-strong hover:bg-bg-subtle/60 focus-visible:border-accent"
                >
                  <IntegrationLogo id={i.id} name={i.name} size="lg" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-fg">{i.name}</span>
                      {i.liveCapable && <Badge tone="success" size="xs">Live</Badge>}
                    </span>
                    <span className="block truncate text-xs text-subtle">
                      {i.auth?.type === 'none' ? 'No credentials needed' : i.id === 'mcp' ? 'Remote URL or local server' : `Authenticates with ${authLabel(i.auth?.type)}`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {!groups.length && <EmptyState icon={Search} title="No integrations match" body={`Nothing is called “${filter}”.`} compact />}
      </div>
    </Dialog>
  );
}

const AUTH_LABELS = { apiKey: 'an API key', bearer: 'a bearer token', basic: 'username + password', webhookUrl: 'a webhook URL', custom: 'custom credentials' };
const authLabel = (type) => AUTH_LABELS[type] || type || 'credentials';

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Check, Circle, FlaskConical, Layers, Play, Timer } from 'lucide-react';
import { getTemplate } from '../../api/templates';
import { apiErrorMessage } from '../../api/client';
import { Badge, Button, Dialog, IntegrationLogo, Skeleton, cx } from '../ui/index';
import TemplateGraphPreview from './TemplateGraphPreview';
import { TRIGGER_META } from '../workflows/workflowMeta';
import { DIFFICULTY, categoryMeta, describeTemplateTrigger, templateIcon, templateIntegrations } from './templateMeta';

/**
 * Everything you'd want to know before using a template: the real problem it
 * solves, the graph, what it needs connected, what it creates, and a sample
 * payload - then one compact "Use template" (or use and test-run it at once).
 */
export default function TemplateDetail({
  template: summary, names, catalog, connections, wp, canUse, canAuthorCode, onUse, onClose, busy,
}) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError('');
    getTemplate(summary._id)
      .then((d) => !cancelled && setDetail(d))
      .catch((err) => !cancelled && setError(apiErrorMessage(err, 'Could not load this template')));
    return () => { cancelled = true; };
  }, [summary._id]);

  const t = detail || summary;
  const Icon = templateIcon(t);
  const category = categoryMeta(t.category);
  const trigger = TRIGGER_META[t.triggerType || t.trigger?.type] || TRIGGER_META.manual;
  const TriggerIcon = trigger.icon;
  const difficulty = DIFFICULTY[t.difficulty];
  const integrations = templateIntegrations(t);
  const blockedByCode = t.usesCode && !canAuthorCode;
  const companions = detail?.companionTemplates || [];

  const footer = canUse ? (
    <>
      {blockedByCode && (
        <span className="mr-auto flex items-center gap-1.5 text-xs text-warning-subtle-fg">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Contains a Code node — only owners and admins can use it
        </span>
      )}
      <Button variant="secondary" icon={FlaskConical} onClick={() => onUse(t, { testRun: true })} disabled={busy || blockedByCode} data-testid="use-and-test">
        Use &amp; test run
      </Button>
      <Button icon={Play} onClick={() => onUse(t)} loading={busy === 'use'} disabled={Boolean(busy) || blockedByCode} data-testid="use-template">
        Use template
      </Button>
    </>
  ) : <span className="text-xs text-subtle">Viewers can browse templates; ask an editor to create a workflow from one.</span>;

  return (
    <Dialog open onClose={onClose} size="xl" title={t.name} description={category.value} icon={Icon} footer={footer} testId="template-detail">
      {detail ? (
        <TemplateGraphPreview nodes={detail.nodes} edges={detail.edges} className="mb-5 h-[340px]" />
      ) : error ? (
        <p className="mb-5 rounded-card border border-default p-4 text-sm text-danger">{error}</p>
      ) : (
        <Skeleton className="mb-5 h-[300px] w-full" />
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-5">
          <p className="text-sm leading-6 text-fg">{t.useCase || t.summary || t.description}</p>

          {(companions.length > 0 || t.companions?.length > 0) && (
            <section>
              <h3 className="mb-2 text-xs font-medium text-subtle">Using it creates</h3>
              <ul className="space-y-1.5 text-sm">
                <li className="flex items-center gap-2 text-fg">
                  <Layers className="h-4 w-4 text-subtle" aria-hidden="true" /> {t.name} <span className="text-xs text-subtle">— the main workflow</span>
                </li>
                {companions.map((c) => (
                  <li key={c._id || c.key} className="flex items-center gap-2 text-fg">
                    <Layers className="h-4 w-4 text-subtle" aria-hidden="true" /> {c.name}
                    <span className="text-xs text-subtle">— published, runs once per item ({c.nodeCount} nodes)</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {t.sampleInput && (
            <section>
              <h3 className="mb-2 text-xs font-medium text-subtle">Sample input</h3>
              <pre className="max-h-48 overflow-auto rounded-card border border-default bg-surface-sunken p-3 font-mono text-xs leading-5 text-fg">
                {JSON.stringify(t.sampleInput, null, 2)}
              </pre>
              <p className="mt-1.5 text-xs text-subtle">“Use &amp; test run” starts a draft run with this payload so you can watch every step.</p>
            </section>
          )}
        </div>

        <aside className="space-y-5">
          <section>
            <h3 className="mb-2 text-xs font-medium text-subtle">Needs</h3>
            {integrations.length ? (
              <ul className="space-y-2">
                {integrations.map((id) => (
                  <RequirementRow key={id} id={id} names={names} catalog={catalog} connections={connections} wp={wp} />
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Nothing to connect — it runs as is.</p>}
            {integrations.length > 0 && (
              <p className="mt-2 text-xs text-subtle">Anything not connected runs in the sandbox until you add a connection.</p>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium text-subtle">Details</h3>
            <dl className="space-y-2 text-sm">
              <Detail label="Trigger">
                <span className="flex items-center gap-1.5"><TriggerIcon className="h-3.5 w-3.5 text-subtle" aria-hidden="true" />{describeTemplateTrigger(t, names)}</span>
              </Detail>
              {difficulty && <Detail label="Level"><Badge tone={difficulty.tone} size="xs">{difficulty.label}</Badge></Detail>}
              {t.estimatedSetupMinutes && (
                <Detail label="Setup"><span className="flex items-center gap-1.5 tabular-nums"><Timer className="h-3.5 w-3.5 text-subtle" aria-hidden="true" />~{t.estimatedSetupMinutes} min</span></Detail>
              )}
              <Detail label="Size"><span className="tabular-nums">{t.nodeCount} nodes · {t.edgeCount ?? detail?.edges?.length ?? 0} connections</span></Detail>
              {!t.builtIn && t.createdByName && <Detail label="By">{t.createdByName}</Detail>}
            </dl>
          </section>

          {t.tags?.length > 0 && (
            <section className="flex flex-wrap gap-1.5">
              {t.tags.map((tag) => <Badge key={tag} tone="neutral" size="xs">{tag}</Badge>)}
            </section>
          )}
        </aside>
      </div>
    </Dialog>
  );
}

function Detail({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-right text-fg">{children}</dd>
    </div>
  );
}

/** One required integration: connected, runs without setup, or "connect it". */
function RequirementRow({ id, names, catalog, connections, wp }) {
  const manifest = (catalog || []).find((i) => i.id === id);
  const noAuth = manifest?.auth?.type === 'none' || ['ai', 'knowledge', 'database', 'builtin'].includes(id);
  const connected = (connections || []).some((c) => c.integration === id);
  let state;
  if (connected) state = { icon: Check, text: 'Connected', cls: 'text-success' };
  else if (noAuth) state = { icon: Check, text: 'No setup needed', cls: 'text-subtle' };
  else state = { icon: Circle, text: 'Not connected', cls: 'text-subtle' };
  const StateIcon = state.icon;
  return (
    <li className="flex items-center gap-2.5">
      <IntegrationLogo id={id} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{names?.get(id) || manifest?.name || id}</p>
        <p className={cx('flex items-center gap-1 text-xs', state.cls)}><StateIcon className="h-3 w-3" aria-hidden="true" />{state.text}</p>
      </div>
      {!connected && !noAuth && (
        <Link to={wp(`/integrations/${id}`)} className="inline-flex items-center gap-0.5 text-xs font-medium text-accent hover:underline">
          Connect <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      )}
    </li>
  );
}


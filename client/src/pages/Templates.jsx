import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LayoutTemplate, Search, X } from 'lucide-react';
import { listTemplates, createWorkflowFromTemplate, deleteTemplate } from '../api/templates';
import { createRun } from '../api/workflows';
import { apiErrorMessage } from '../api/client';
import { Button, Combobox, EmptyState, IntegrationLogo, Input, Kbd, PageHeader, Select, SkeletonGrid, cx } from '../components/ui/index';
import { ErrorText } from '../components/ui.jsx';
import TemplateCard from '../components/TemplateCard';
import TemplateDetail from '../components/templates/TemplateDetail';
import { CATEGORIES, DIFFICULTY, templateIntegrations } from '../components/templates/templateMeta';
import { TRIGGER_META } from '../components/workflows/workflowMeta';
import EditTemplateDialog from '../components/EditTemplateDialog';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useCan } from '../hooks/useCan';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useIntegrationStore } from '../store/integrationStore';
import { useToastStore } from '../store/toastStore';
import { confirm } from '../components/ui/confirm';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function Templates() {
  const canUse = useCan('templates:use');
  const canManage = useCan('templates:create');
  const canAuthorCode = useCan('code:author');
  const [templates, setTemplates] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null); // 'use' | 'test' while creating
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [integration, setIntegration] = useState('');
  const [difficulty, setDifficulty] = useState('any');
  const [trigger, setTrigger] = useState('any');
  const [params, setParams] = useSearchParams();
  const category = params.get('category') || 'all';
  const openId = params.get('template');
  const searchRef = useRef(null);
  const navigate = useNavigate();
  const wp = useWorkspacePath();
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  const { catalog, loadCatalog, connections, loadConnections } = useIntegrationStore();
  useDocumentTitle('Templates');

  const reload = () => listTemplates()
    .then(setTemplates)
    .catch((err) => { setError(apiErrorMessage(err, 'Failed to load templates')); setTemplates([]); });

  useEffect(() => { reload(); }, []);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => { if (workspaceId) loadConnections(workspaceId); }, [workspaceId, loadConnections]);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const names = useMemo(() => new Map((catalog || []).map((i) => [i.id, i.name])), [catalog]);

  // Companion templates are loop bodies another template creates for you; they
  // aren't something to start from on their own.
  const browsable = useMemo(() => (templates || []).filter((t) => !t.companion), [templates]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value == null || value === 'all') next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };

  const matches = (t, { ignoreCategory = false } = {}) => {
    const q = query.trim().toLowerCase();
    const text = `${t.name} ${t.summary || ''} ${t.description || ''} ${(t.tags || []).join(' ')} ${templateIntegrations(t).map((id) => names.get(id) || id).join(' ')}`.toLowerCase();
    return (!q || text.includes(q))
      && (ignoreCategory || category === 'all' || t.category === category)
      && (!integration || templateIntegrations(t).includes(integration))
      && (difficulty === 'any' || t.difficulty === difficulty)
      && (trigger === 'any' || (t.triggerType || t.trigger?.type || 'manual') === trigger);
  };

  const counts = useMemo(() => {
    const byCat = new Map();
    let all = 0;
    for (const t of browsable) {
      if (!matches(t, { ignoreCategory: true })) continue;
      all += 1;
      byCat.set(t.category, (byCat.get(t.category) || 0) + 1);
    }
    return { all, byCat };
  }, [browsable, query, integration, difficulty, trigger, names]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = browsable.filter((t) => matches(t));
  const team = visible.filter((t) => !t.builtIn);
  const builtIns = visible.filter((t) => t.builtIn);
  const openTemplate = openId ? (templates || []).find((t) => t._id === openId) : null;

  const integrationOptions = useMemo(() => {
    const ids = [...new Set(browsable.flatMap(templateIntegrations))];
    return ids
      // Combobox takes an icon *component*; bind each logo to its id.
      .map((id) => ({ value: id, label: names.get(id) || id, icon: function Logo() { return <IntegrationLogo id={id} size="xs" />; } }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [browsable, names]);

  const filtersActive = query || integration || difficulty !== 'any' || trigger !== 'any' || category !== 'all';
  function clearFilters() {
    setQuery(''); setIntegration(''); setDifficulty('any'); setTrigger('any');
    setParam('category', null);
  }

  async function handleUse(template, { testRun = false } = {}) {
    setBusy(testRun ? 'test' : 'use');
    setError('');
    try {
      const result = await createWorkflowFromTemplate(template._id);
      const extra = result.companions?.length ? ` (plus ${result.companions.length} companion workflow${result.companions.length > 1 ? 's' : ''})` : '';
      if (testRun) {
        const { runId } = await createRun(result._id, 'draft', result.sampleInput ?? template.sampleInput ?? undefined);
        useToastStore.getState().push(`Created “${result.name}”${extra} and started a test run.`, 'success');
        navigate(wp(`/runs/${runId}`));
      } else {
        useToastStore.getState().push(`Created “${result.name}”${extra}.`, 'success');
        navigate(wp(`/workflows/${result._id}`));
      }
    } catch (err) {
      if (err?.response?.status === 404) {
        useToastStore.getState().push('That template was just deleted.', 'info');
        setParam('template', null);
        reload();
      } else {
        setError(apiErrorMessage(err, 'Failed to create a workflow from this template'));
      }
      setBusy(null);
    }
  }

  async function handleDelete(template) {
    const ok = await confirm({
      title: `Delete “${template.name}”?`,
      body: 'Workflows already created from this template keep working; they are independent copies.',
      confirmLabel: 'Delete template',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTemplate(template._id);
      setTemplates((ts) => ts.filter((t) => t._id !== template._id));
      useToastStore.getState().push('Template deleted.', 'success');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to delete template'));
    }
  }

  const grid = (list) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((t) => (
        <TemplateCard
          key={t._id}
          template={t}
          names={names}
          onOpen={(tpl) => setParam('template', tpl._id)}
          onEdit={canManage && !t.builtIn ? setEditing : undefined}
          onDelete={canManage && !t.builtIn ? handleDelete : undefined}
        />
      ))}
    </div>
  );

  const loading = templates === null;

  return (
    <div>
      <PageHeader
        title="Templates"
        description="Workflows built around real problems — failed payments, support triage, incident escalation and more. Using one creates an independent copy you can change freely."
      />

      <ErrorText>{error}</ErrorText>

      {!loading && browsable.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
                placeholder="Search templates, tools or use cases"
                aria-label="Search templates"
                className="pl-8 pr-8"
                data-testid="template-search"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"><Kbd>/</Kbd></span>
            </div>
            <div className="w-[190px]"><Combobox
              options={integrationOptions}
              value={integration}
              onChange={(v) => setIntegration(v || '')}
              placeholder="Any integration"
              searchPlaceholder="Search integrations…"
              clearable
              size="sm"
              aria-label="Filter by integration"
            /></div>
            <div className="w-[140px]"><Select
              size="sm"
              value={trigger}
              onValueChange={setTrigger}
              aria-label="Filter by trigger"
              options={[{ value: 'any', label: 'Any trigger' }, ...Object.entries(TRIGGER_META).map(([value, m]) => ({ value, label: m.label, icon: m.icon }))]}
            /></div>
            <div className="w-[130px]"><Select
              size="sm"
              value={difficulty}
              onValueChange={setDifficulty}
              aria-label="Filter by level"
              options={[{ value: 'any', label: 'Any level' }, ...Object.entries(DIFFICULTY).map(([value, d]) => ({ value, label: d.label }))]}
            /></div>
            {filtersActive && <Button variant="ghost" size="sm" icon={X} onClick={clearFilters}>Clear</Button>}
          </div>

          <div className="mb-6 flex flex-wrap gap-1.5" role="tablist" aria-label="Categories" data-testid="template-categories">
            <CategoryChip active={category === 'all'} onClick={() => setParam('category', null)} label="All" count={counts.all} />
            {CATEGORIES.map((c) => (
              <CategoryChip
                key={c.value}
                active={category === c.value}
                onClick={() => setParam('category', c.value)}
                label={c.value}
                icon={c.icon}
                count={counts.byCat.get(c.value) || 0}
              />
            ))}
          </div>
        </>
      )}

      {loading ? (
        <SkeletonGrid count={6} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" />
      ) : browsable.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title="No templates yet"
          body={<>Run <code className="font-mono">npm run seed:templates</code> in <code className="font-mono">server/</code> to add the built-in ones, or save one of your workflows as a template from the Builder.</>}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          compact
          icon={Search}
          title="No templates match"
          body="Try another search, category or filter."
          action={<Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>}
        />
      ) : (
        <div className="space-y-8" data-testid="template-gallery">
          {team.length > 0 && (
            <section>
              <SectionHeading title="Your team’s templates" count={team.length} />
              {grid(team)}
            </section>
          )}
          {builtIns.length > 0 && (
            <section>
              {team.length > 0 && <SectionHeading title="From AgentFlow" count={builtIns.length} />}
              {grid(builtIns)}
            </section>
          )}
        </div>
      )}

      {openTemplate && (
        <TemplateDetail
          template={openTemplate}
          names={names}
          catalog={catalog}
          connections={connections}
          wp={wp}
          canUse={canUse}
          canAuthorCode={canAuthorCode}
          busy={busy}
          onUse={handleUse}
          onClose={() => setParam('template', null)}
        />
      )}

      {editing && (
        <EditTemplateDialog
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setTemplates((ts) => ts.map((t) => (t._id === updated._id ? { ...t, ...updated, createdByName: t.createdByName } : t)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function SectionHeading({ title, count }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-xs font-medium text-subtle">
      {title}
      <span className="rounded-full bg-bg-subtle px-1.5 text-2xs font-semibold tabular-nums text-muted">{count}</span>
    </h2>
  );
}

function CategoryChip({ active, onClick, label, count, icon: Icon }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active ? 'border-accent/40 bg-accent-subtle text-accent-subtle-fg' : 'border-default bg-surface text-muted hover:border-strong hover:text-fg',
        !active && count === 0 && 'opacity-50',
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {label}
      <span className={cx('tabular-nums', active ? 'text-accent-subtle-fg/80' : 'text-subtle')}>{count}</span>
    </button>
  );
}

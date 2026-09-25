import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, BookOpen, Copy, CopyPlus, ExternalLink, Eye, EyeOff, GripVertical, Hash, Info, MessageSquarePlus, MoreHorizontal, PencilLine, Settings2, SlidersHorizontal, SquareTerminal, Trash2, X, Zap } from 'lucide-react';
import { Checkbox, Switch, NumberInput, Field, Input, Textarea } from './ui/Form';
import NodeTypeIcon from './ui/NodeTypeIcon';
import Tabs from './ui/Tabs';
import Button from './ui/Button';
import EmptyState from './ui/EmptyState';
import CopyButton from './ui/CopyButton';
import { StatusBadge } from './ui/Badge';
import { Menu, MenuButton, MenuSeparator } from './ui/Menu';
import { cx } from './ui/cx';
import { useWorkflowStore } from '../store/workflowStore';
import { useIntegrationStore, connectionById } from '../store/integrationStore';
import { findIntegration, predictMode } from '../utils/integrationCatalog';
import { normalizeToolConfig } from '../utils/normalizeToolConfig';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useCan } from '../hooks/useCan';
import HandoffCandidates from './HandoffCandidates';
import ToolNodeFields from './ToolNodeFields';
import MockBehaviorFields from './MockBehaviorFields';
import AgentToolsField from './nodePanels/AgentToolsField';
import { ADVANCED_PANELS } from './nodePanels';
import { useSoftLock } from '../collab/useSoftLock';
import { useCanvasUi } from './canvas/canvasUiStore';
import { nodeResultOf } from './canvas/useLatestRun';
import { nodeLabel, NODE_HINTS } from './nodeCatalog';

const TABS = [
  { value: 'settings', label: 'Settings', icon: Settings2 },
  { value: 'advanced', label: 'Advanced', icon: SlidersHorizontal },
  { value: 'output', label: 'Output', icon: SquareTerminal },
  { value: 'docs', label: 'Docs', icon: BookOpen },
];

/** What each node type does - the Docs tab's opening paragraph. */
const DOCS = {
  start: 'Where every run begins. Its output is the run input: the trigger payload (webhook body, event, schedule tick) or the test input you run with. A workflow has exactly one Start.',
  end: 'Collects the run’s result: whatever reaches it becomes the run output shown in the monitor and returned by the public API.',
  agent: 'An LLM step. It reads its input, follows the system prompt, and can call the tools you give it (MCP tools and integration actions) before answering. As a handoff agent it picks which outgoing branch runs instead.',
  tool: 'Calls one integration action — Slack, GitHub, HTTP, a database and so on. It runs live when its connection has credentials and live mode is on, otherwise against the per-workspace sandbox.',
  condition: 'Branches on a JavaScript expression evaluated against the incoming node’s `output`. Truthy follows the true handle, falsy the false handle; the other branch is skipped.',
  transform: 'Reshapes data without code: each mapping writes a key using {{ }} templates over the input. Replace outputs only the mapped keys; Merge writes them over the input.',
  code: 'Runs a JavaScript function body with `input`. Return the new value. Runs in an isolated worker with a time and memory limit — trusted workspace code, not a security sandbox.',
  delay: 'Waits for a duration (or until a time) before continuing. Short waits hold nothing; long ones park the run, which survives a server restart.',
  loop: 'Runs a published body workflow once per item of an array, a few at a time, and collects the results in order.',
  merge: 'Joins parallel branches: wait for all of them, continue with whichever arrive, or take the first to finish.',
  subworkflow: 'Runs another published workflow in this workspace as a child run and continues with its output.',
  approval: 'Pauses the run until the assigned people approve or reject. Approved follows one handle, rejected the other; an optional timeout picks a default.',
};

/**
 * The node inspector. `actions` are the same handlers as the node's context
 * menu (duplicate, disable, comment, …) so both surfaces stay in step.
 * `readOnly` (viewers, spec/23): fields render disabled rather than hidden, so a
 * viewer can still read how a node is configured.
 */
export default function NodeConfigPanel({ readOnly = false, actions = null }) {
  const { nodes, selectedNodeId, selectNode, updateNodeConfig } = useWorkflowStore();
  const node = nodes.find((n) => n.id === selectedNodeId);
  // spec/28 §5: opening the panel takes a soft lock on the node's config; while
  // someone else holds it the fields stay live but read-only.
  const lock = useSoftLock(node ? node.id : null, { enabled: !readOnly });
  const loadCatalog = useIntegrationStore((s) => s.loadCatalog);
  const tab = useCanvasUi((s) => s.inspectorTab);
  const setTab = useCanvasUi((s) => s.setInspectorTab);
  const width = useCanvasUi((s) => s.inspectorWidth);
  const problem = useCanvasUi((s) => (node ? s.problems[node.id] : null));
  const latestRun = useCanvasUi((s) => s.latestRun);
  const canComment = useCan('comments:write');

  useEffect(() => {
    if (node?.type === 'tool' || node?.type === 'agent') loadCatalog();
  }, [node?.type, loadCatalog]);

  if (!node) return null;

  const config = node.data?.config || {};
  const locked = readOnly || lock.readOnly;
  const disabled = Boolean(config.disabled);
  const canDisable = node.type !== 'start' && node.type !== 'end';
  const set = (patch) => updateNodeConfig(node.id, patch);
  const result = nodeResultOf(latestRun, node.id);

  return (
    <aside
      data-testid="node-config-panel"
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-l border-default bg-surface"
      aria-label="Node settings"
    >
      <ResizeHandle />

      {/* Header: icon, editable name, what it is, ⋯ menu, close. */}
      <div className="flex shrink-0 items-start gap-2.5 border-b border-default px-4 py-3">
        <NodeTypeIcon type={node.type} size="lg" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <NodeName node={node} readOnly={locked} onRename={(label) => set({ label })} />
          <p className="truncate text-xs text-subtle">{describeNode(node)}</p>
        </div>
        {actions && (
          <Menu
            align="right"
            title="Node actions"
            testId="inspector-more"
            label={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
            buttonClassName="inline-flex h-7 w-7 items-center justify-center rounded-control text-subtle hover:bg-bg-subtle hover:text-fg"
          >
            {!readOnly && <MenuButton onClick={() => actions.duplicate([node.id])} disabled={node.type === 'start'}><CopyPlus /> Duplicate</MenuButton>}
            <MenuButton onClick={() => actions.copy([node.id])}><Copy /> Copy</MenuButton>
            {!readOnly && canDisable && (
              <MenuButton onClick={() => actions.setDisabled([node.id], !disabled)}>
                {disabled ? <Eye /> : <EyeOff />} {disabled ? 'Enable node' : 'Disable node'}
              </MenuButton>
            )}
            {canComment && <MenuButton onClick={() => actions.commentOnNode(node.id)}><MessageSquarePlus /> Add comment</MenuButton>}
            <MenuButton onClick={() => actions.copyId(node.id)}><Hash /> Copy node ID</MenuButton>
            {!readOnly && (
              <>
                <MenuSeparator />
                <MenuButton danger onClick={() => actions.remove([node.id])}><Trash2 /> Delete</MenuButton>
              </>
            )}
          </Menu>
        )}
        <button onClick={() => selectNode(null)} aria-label="Close panel" className="rounded-control p-1 text-subtle hover:bg-bg-subtle hover:text-fg">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="shrink-0 px-4 pt-2">
        <Tabs items={TABS} value={tab} onChange={setTab} size="sm" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          {lock.readOnly && (
            <div data-testid="lock-banner" className="rounded-control border border-warning/30 bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-fg">
              {lock.released ? (
                <span className="flex items-center justify-between gap-2">
                  <span>{lock.heldBy?.name || 'They'} finished.</span>
                  <button type="button" onClick={lock.acquire} className="font-semibold underline">Edit now</button>
                </span>
              ) : lock.otherTab ? (
                "You're editing this node in another tab."
              ) : (
                `${lock.heldBy?.name || 'Someone'} is editing this node.`
              )}
            </div>
          )}
          {disabled && (
            <div data-testid="disabled-banner" className="flex items-start gap-2 rounded-control border border-default bg-bg-subtle px-3 py-2 text-xs text-muted">
              <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="flex-1">Disabled — this node is skipped and passes its input straight through.</span>
              {!readOnly && <button type="button" onClick={() => set({ disabled: false })} className="font-semibold text-accent hover:underline">Enable</button>}
            </div>
          )}
          {tab === 'settings' && problem && <ProblemList problem={problem} />}
          {readOnly && tab !== 'docs' && tab !== 'output' && (
            <p className="rounded-control bg-bg-subtle px-3 py-2 text-xs text-muted">Read-only — your role can view this workflow but not change it.</p>
          )}

          {tab === 'settings' && (
            // min-w-0: a fieldset defaults to min-width: min-content, so one long
            // truncated line would otherwise widen the whole panel.
            <fieldset disabled={locked} className="min-w-0 space-y-4">
              <SettingsFields node={node} set={set} readOnly={readOnly} />
            </fieldset>
          )}
          {tab === 'advanced' && (
            <fieldset disabled={locked} className="min-w-0 space-y-4">
              <AdvancedFields node={node} set={set} canDisable={canDisable} />
            </fieldset>
          )}
          {tab === 'output' && <OutputTab node={node} result={result} run={latestRun} />}
          {tab === 'docs' && <DocsTab node={node} />}
        </div>
      </div>

      <div className="shrink-0 border-t border-default px-4 py-2.5">
        <Button variant="secondary" className="w-full" onClick={() => selectNode(null)}>Done</Button>
      </div>
    </aside>
  );
}

function describeNode(node) {
  if (node.type === 'tool') {
    const cfg = normalizeToolConfig(node.data?.config || {});
    return cfg.integration ? `Tool · ${cfg.integration}${cfg.action ? ` · ${cfg.action}` : ''}` : 'Tool · no integration yet';
  }
  return `${nodeLabel(node.type)} · ${NODE_HINTS[node.type] || ''}`.replace(/ · $/, '');
}

/** The node's name, edited in place (same field as the canvas's inline rename). */
function NodeName({ node, readOnly, onRename }) {
  const label = node.data?.config?.label || nodeLabel(node.type);
  const [draft, setDraft] = useState(null);
  return (
    <div className="flex items-center gap-1">
      <input
        value={draft ?? label}
        readOnly={readOnly}
        aria-label="Node name"
        data-testid="inspector-node-name"
        onFocus={() => setDraft(label)}
        onBlur={() => { if (draft !== null && draft.trim() && draft !== label) onRename(draft.trim()); setDraft(null); }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }}
        className="-ml-1 h-7 w-full min-w-0 rounded border border-transparent bg-transparent px-1 text-sm font-semibold text-fg hover:border-default focus:border-accent focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20 read-only:hover:border-transparent"
      />
      {!readOnly && <PencilLine className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />}
    </div>
  );
}

/** Drag the panel's left edge to resize it; the width is remembered per browser. */
function ResizeHandle() {
  const start = useRef(null);
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  function onPointerDown(e) {
    e.preventDefault();
    start.current = { x: e.clientX, width: useCanvasUi.getState().inspectorWidth };
    document.body.style.cursor = 'col-resize';
    const move = (ev) => useCanvasUi.getState().setInspectorWidth(start.current.width + (start.current.x - ev.clientX));
    const up = () => {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      data-testid="inspector-resize"
      onPointerDown={onPointerDown}
      onDoubleClick={() => useCanvasUi.getState().setInspectorWidth(360)}
      className="group absolute inset-y-0 -left-1 z-10 flex w-2 cursor-col-resize items-center justify-center"
    >
      <span className="h-8 w-1 rounded-full bg-transparent transition-colors group-hover:bg-accent/40" />
      <GripVertical className="pointer-events-none absolute h-3.5 w-3.5 text-subtle opacity-0 group-hover:opacity-100" aria-hidden="true" />
    </div>
  );
}

const PROBLEM_ICON = { error: AlertCircle, warning: AlertTriangle, info: Info };
const PROBLEM_TONE = {
  error: 'border-danger/30 bg-danger-subtle text-danger-subtle-fg',
  warning: 'border-warning/30 bg-warning-subtle text-warning-subtle-fg',
  info: 'border-info/30 bg-info-subtle text-info-subtle-fg',
};

function ProblemList({ problem }) {
  return (
    <ul data-testid="inspector-problems" className="space-y-1.5">
      {problem.items.map((p) => {
        const Icon = PROBLEM_ICON[p.level];
        return (
          <li key={p.id} className={cx('flex items-start gap-2 rounded-control border px-2.5 py-1.5 text-xs', PROBLEM_TONE[p.level])}>
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{p.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

function SettingsFields({ node, set, readOnly }) {
  const config = node.data?.config || {};
  const [exprError, setExprError] = useState('');

  function validateExpression(expr) {
    try {
      // eslint-disable-next-line no-new-func
      new Function('output', `"use strict"; return Boolean(${expr});`);
      setExprError('');
    } catch {
      setExprError('Invalid expression syntax');
    }
  }

  if (node.type === 'start') {
    return (
      <p className="text-sm text-muted">
        The Start node has nothing to configure. What starts a run — a schedule, a webhook or an event — is set in the
        <span className="font-medium text-fg"> Triggers</span> panel (the <Zap className="inline h-3.5 w-3.5 align-[-2px]" aria-label="lightning" /> button on the left rail).
      </p>
    );
  }
  if (node.type === 'end') {
    return <p className="text-sm text-muted">The End node has nothing to configure: whatever reaches it becomes the run’s output.</p>;
  }

  return (
    <>
      {node.type === 'agent' && (
        <>
          <Field label="System prompt" help="The agent’s role and instructions.">
            <Textarea
              rows={6}
              value={config.systemPrompt || ''}
              onChange={(e) => set({ systemPrompt: e.target.value })}
              placeholder="Describe this agent's role and behavior..."
            />
          </Field>
          <Checkbox
            label="Agent handoff (dynamic delegation)"
            description="This agent's output picks which outgoing branch runs; the rest are skipped."
            checked={Boolean(config.isHandoff)}
            onCheckedChange={(v) => set({ isHandoff: Boolean(v) })}
          />
          {config.isHandoff && <HandoffCandidates nodeId={node.id} />}
          {/* spec/37 §5: MCP tools and integration actions the agent may call. */}
          <AgentToolsField config={config} set={set} readOnly={readOnly} />
        </>
      )}

      {node.type === 'tool' && <ToolNodeFields node={node} set={set} readOnly={readOnly} hideBehavior />}

      {node.type === 'condition' && (
        <Field
          label="Expression"
          error={exprError || undefined}
          help={<>Evaluated against the incoming node’s <code className="font-mono">output</code>. Truthy → true branch.</>}
        >
          <Input
            value={config.expression || ''}
            invalid={Boolean(exprError)}
            className="font-mono"
            onChange={(e) => {
              set({ expression: e.target.value });
              validateExpression(e.target.value);
            }}
            placeholder="output.amount > 100"
          />
        </Field>
      )}

      {ADVANCED_PANELS[node.type] && (() => {
        // spec/31 node types each own their panel; see components/nodePanels.
        const Panel = ADVANCED_PANELS[node.type];
        return <Panel config={config} set={set} readOnly={readOnly} />;
      })()}
    </>
  );
}

const RETRY_TYPES = ['agent', 'code'];

function AdvancedFields({ node, set, canDisable }) {
  const config = node.data?.config || {};
  const catalog = useIntegrationStore((s) => s.catalog);
  const connections = useIntegrationStore((s) => s.connections);
  const defaults = useIntegrationStore((s) => s.defaults);
  const liveEnabled = useIntegrationStore((s) => s.liveEnabled);

  const toolMode = (() => {
    if (node.type !== 'tool') return 'sandbox';
    const cfg = normalizeToolConfig(config);
    const integration = findIntegration(catalog, cfg.integration);
    const action = integration?.actions?.find((a) => a.id === cfg.action);
    if (!integration || !action) return 'sandbox';
    const connection = cfg.connectionId && cfg.connectionId !== 'sandbox' ? connectionById(connections, cfg.connectionId) : null;
    const m = predictMode({ integration, action, connectionId: cfg.connectionId, connection, liveEnabled });
    return m === 'unknown' ? 'sandbox' : m;
  })();

  const overrides = config.mockOverrides || {};

  return (
    <>
      {canDisable ? (
        <Switch
          data-testid="toggle-disabled"
          label="Disable this node"
          description="Skip it: its input passes straight through to the next node. Handy for switching a step off while you test."
          checked={Boolean(config.disabled)}
          onCheckedChange={(v) => set({ disabled: Boolean(v) })}
        />
      ) : (
        <p className="text-xs text-subtle">Start and End can’t be disabled — a run needs a beginning and a result.</p>
      )}

      {node.type === 'tool' && normalizeToolConfig(config).action && (
        <MockBehaviorFields overrides={overrides} defaults={defaults} mode={toolMode} onChange={(mockOverrides) => set({ mockOverrides })} />
      )}

      {RETRY_TYPES.includes(node.type) && (
        <Field
          label="Max attempts"
          help={`Retries with exponential backoff before the node fails${node.type === 'code' ? ' (code defaults to 1 — no retries)' : ` (server default ${defaults?.maxAttempts ?? 3})`}. An error branch runs only after the last attempt.`}
        >
          <NumberInput
            min={1}
            max={10}
            value={overrides.maxAttempts ?? ''}
            placeholder={node.type === 'code' ? '1' : String(defaults?.maxAttempts ?? 3)}
            onValueChange={(v) => {
              const next = { ...overrides };
              if (v === '' || v === null) delete next.maxAttempts;
              else next.maxAttempts = v;
              set({ mockOverrides: next });
            }}
          />
        </Field>
      )}

      <Field label="Node ID" help="Stable id — used in expressions, the public API and run results.">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-control border border-default bg-surface-sunken px-2 py-1.5 font-mono text-xs text-muted">{node.id}</code>
          <CopyButton value={node.id} label="Copy" />
        </div>
      </Field>
      <p className="text-xs text-subtle">
        Whole-run limits (timeout, concurrency) are set per workspace; see Settings → Usage &amp; plan.
      </p>
    </>
  );
}

function OutputTab({ node, result, run }) {
  const wp = useWorkspacePath();
  if (!run || !result || result.status === 'pending') {
    return (
      <EmptyState
        icon={SquareTerminal}
        compact
        title="No output yet"
        body={run ? 'This node didn’t run in the latest run.' : 'Run the workflow (Test run) to see what this node produced.'}
      />
    );
  }
  const disabledSkip = result.skipReason === 'disabled';
  const json = safeJson(result.output);
  return (
    <div className="space-y-3" data-testid="inspector-output">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <StatusBadge status={result.status} label={disabledSkip ? 'Disabled · passed through' : undefined} />
        {result.durationMs !== undefined && <span className="tabular-nums">{result.durationMs} ms</span>}
        {result.attempts > 1 && <span>{result.attempts} attempts</span>}
        {result.mode && <span className="uppercase">{result.mode}</span>}
        <Link to={wp(`/runs/${run._id || run.id}`)} className="ml-auto inline-flex items-center gap-1 font-medium text-accent hover:underline">
          Open run <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      <div className="relative">
        <pre className="max-h-[360px] overflow-auto rounded-control border border-default bg-surface-sunken p-3 font-mono text-xs leading-relaxed text-fg">{json}</pre>
        <div className="absolute right-2 top-2"><CopyButton value={json} label="Copy" /></div>
      </div>
      {result.logs?.length > 0 && (
        <details className="rounded-control border border-default">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted">Logs ({result.logs.length})</summary>
          <ol className="max-h-48 space-y-0.5 overflow-auto border-t border-default px-3 py-2 font-mono text-2xs text-muted">
            {result.logs.map((line, i) => <li key={i}>{line}</li>)}
          </ol>
        </details>
      )}
      <p className="text-2xs text-subtle">From the latest run{run.isDraft ? ' (a test run of the draft)' : ''}. {node.data?.config?.label || node.id}.</p>
    </div>
  );
}

function DocsTab({ node }) {
  const catalog = useIntegrationStore((s) => s.catalog);
  const cfg = node.type === 'tool' ? normalizeToolConfig(node.data?.config || {}) : null;
  const integration = cfg ? findIntegration(catalog, cfg.integration) : null;
  const action = integration?.actions?.find((a) => a.id === cfg.action) || null;
  return (
    <div className="space-y-4 text-sm" data-testid="inspector-docs">
      <p className="text-muted">{DOCS[node.type] || NODE_HINTS[node.type]}</p>
      {integration && (
        <div className="space-y-2 rounded-control border border-default p-3">
          <p className="font-medium text-fg">{integration.name}{action ? ` · ${action.name}` : ''}</p>
          {integration.description && <p className="text-xs text-muted">{integration.description}</p>}
          {action?.description && <p className="text-xs text-muted">{action.description}</p>}
          {action && (
            <p className="text-2xs text-subtle">
              {action.sideEffect ? 'Has side effects (not cached, not retried on an ambiguous failure).' : 'Read-only.'}
              {action.cacheable ? ' Results are cached briefly.' : ''}
            </p>
          )}
          {action?.outputSample && (
            <div>
              <p className="mb-1 text-2xs font-medium uppercase tracking-wider text-subtle">Example output</p>
              <pre className="max-h-56 overflow-auto rounded-control bg-surface-sunken p-2 font-mono text-2xs text-muted">{safeJson(action.outputSample)}</pre>
            </div>
          )}
        </div>
      )}
      <div className="space-y-1 text-xs text-subtle">
        <p><span className="font-medium text-muted">Templates:</span> use <code className="font-mono">{'{{input.field}}'}</code> in text fields to read the incoming data.</p>
        <p><span className="font-medium text-muted">Tip:</span> right-click a node for duplicate, disable, comment and more.</p>
      </div>
    </div>
  );
}

function safeJson(value) {
  try {
    return value === undefined ? 'undefined' : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

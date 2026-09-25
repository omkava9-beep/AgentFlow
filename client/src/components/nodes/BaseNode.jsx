import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { Lock, Zap, ArrowLeftRight, Workflow as WorkflowIcon, EyeOff, Plus, PencilLine } from 'lucide-react';
import { NODE_STYLES, STATUS_RING, ERROR_COLOR } from './nodeStyles';
import NodeTypeIcon from '../ui/NodeTypeIcon';
import { StatusIcon } from '../ui/Badge';
import { STATUS_META } from '../ui/statusMeta';
import Tooltip from '../ui/Tooltip';
import ToolNodeSummary from './ToolNodeSummary';
import { cx } from '../ui/cx';
import { useCanvasUi } from '../canvas/canvasUiStore';
import { useWorkflowStore } from '../../store/workflowStore';
import { usePresenceStore } from '../../collab/presence';

const formatMs = (ms) => {
  const n = Number(ms) || 0;
  if (n >= 3_600_000) return `${Math.round(n / 3_600_000)}h`;
  if (n >= 60_000) return `${Math.round(n / 60_000)}m`;
  if (n >= 1000) return `${Math.round(n / 1000)}s`;
  return `${n}ms`;
};

// The one-line summary under the label: what this node will actually do.
function subtitleFor(type, config = {}) {
  switch (type) {
    case 'agent': {
      const parts = ['Agent'];
      if (config.isHandoff) parts.push(`routes to ${(config.candidates || []).length || 'no'} candidate${(config.candidates || []).length === 1 ? '' : 's'}`);
      if (config.tools?.length) parts.push(`${config.tools.length} tool${config.tools.length === 1 ? '' : 's'}`);
      return parts.join(' · ');
    }
    case 'condition': return config.expression ? `if ${String(config.expression)}` : 'No expression yet';
    case 'delay': return config.mode === 'until' ? 'Wait until a time' : `Wait ${formatMs(config.durationMs)}`;
    case 'loop': return `For each ${config.itemsPath || 'item'}${config.concurrency ? ` · ${config.concurrency} at a time` : ''}`;
    case 'merge': return `Merge · ${config.mode === 'first' ? 'first to arrive' : config.mode === 'all' ? 'wait for all' : 'any branch'}`;
    case 'approval': {
      const people = (config.assignees?.userIds || []).length;
      const roles = (config.assignees?.roles || []).length;
      const who = people ? `${people} ${people === 1 ? 'person' : 'people'}` : roles ? `${config.assignees.roles.join(', ')}` : 'owners & admins';
      return `Approval by ${who}`;
    }
    case 'subworkflow': return config.workflowId ? 'Runs a sub-workflow' : 'No workflow picked';
    case 'transform': {
      const n = (config.mappings || []).filter((m) => m.key).length;
      return `${config.mode === 'merge' ? 'Merge' : 'Map'} ${n} field${n === 1 ? '' : 's'}`;
    }
    case 'code': return 'JavaScript';
    case 'start': return 'Trigger · where a run begins';
    case 'end': return 'Output · the run’s result';
    default: return NODE_STYLES[type]?.label || type;
  }
}

const PROBLEM_DOT = { error: 'bg-danger', warning: 'bg-warning', info: 'bg-info' };

/**
 * The canvas node card (248px wide - legible at the default zoom, and still
 * clear of its neighbours at the ~260px spacing templates and seeds use). Shows the
 * type icon, name, a one-line summary, chips (disabled, handoff, cached, a
 * collaborator's lock, the code:author lock), a validation dot, the run status
 * when the overlay or a run view is on, labeled output handles for multi-output
 * nodes, and - on hover, for editors - a quick "+" on each output handle.
 */
function BaseNode({ id, type, data, selected, showTarget = true, showSource = true, sourceHandles = null, errorHandle = false }) {
  const style = NODE_STYLES[type] || NODE_STYLES.tool;
  const status = data.runStatus;
  const cached = data.cached;
  const disabled = Boolean(data.config?.disabled) && type !== 'start' && type !== 'end';
  // spec/33: waiting for a queue slot is a dashed outline, not a status.
  const waiting = data.waiting && status === 'running';
  const label = data.config?.label || style.label || type;

  const readOnly = useWorkflowStore((s) => s.readOnly);
  const problem = useCanvasUi((s) => s.problems[id]);
  const renaming = useCanvasUi((s) => s.renamingNodeId === id);
  const heldBy = usePresenceStore((s) => {
    const lock = s.locks?.[id];
    return lock && lock.socketId !== s.selfSocketId ? lock : null;
  });
  const [hover, setHover] = useState(false);

  const outputs = sourceHandles
    ? sourceHandles
    : showSource
      ? [{ id: null, style: errorHandle ? { top: '40%' } : undefined }]
      : [];
  const allOutputs = errorHandle
    ? [...outputs, { id: 'error', title: 'Error branch — taken only after the node has definitively failed', label: 'error', style: { top: '80%', background: ERROR_COLOR, borderColor: ERROR_COLOR } }]
    : outputs;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cx(
        'group relative w-[248px] rounded-card border bg-surface shadow-sm transition-shadow',
        selected ? 'border-accent shadow-md ring-2 ring-accent/25' : 'border-default hover:border-strong hover:shadow-md',
        'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-l-card',
        style.accent,
        STATUS_RING[status],
        waiting && '!border-dashed !border-info',
        disabled && 'opacity-60 [background-image:repeating-linear-gradient(135deg,transparent,transparent_6px,rgb(var(--border)/0.35)_6px,rgb(var(--border)/0.35)_7px)]',
      )}
      data-disabled={disabled || undefined}
    >
      {showTarget && <Handle type="target" position={Position.Left} className="!h-3 !w-3" />}

      {/* Room on the right for the output-handle labels of multi-output nodes. */}
      <div className={cx('flex items-start gap-3 py-3 pl-4', sourceHandles ? 'pr-12' : 'pr-3.5')}>
        <NodeTypeIcon type={type} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {renaming ? (
              <RenameInput id={id} label={label} />
            ) : (
              <span className={cx('truncate text-[14px] font-semibold leading-5 text-fg', disabled && 'line-through decoration-muted/60')}>{label}</span>
            )}
            {problem && (
              <Tooltip content={problem.messages.join(' · ')}>
                <span
                  data-testid={`node-problem-${id}`}
                  className={cx('h-2 w-2 shrink-0 rounded-full ring-2 ring-surface', PROBLEM_DOT[problem.level])}
                  aria-label={`${problem.level}: ${problem.messages.join('; ')}`}
                />
              </Tooltip>
            )}
            {status && status !== 'pending' && <StatusIcon status={status} className="ml-auto h-4 w-4 shrink-0" />}
          </div>
          {type === 'tool' ? <ToolNodeSummary data={data} /> : (
            <p className="truncate text-[12px] leading-4 text-muted" title={subtitleFor(type, data.config)}>{subtitleFor(type, data.config)}</p>
          )}
          {(disabled || data.config?.isHandoff || cached || heldBy || data.locked) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {disabled && <Chip icon={EyeOff} tone="neutral" testId={`node-disabled-${id}`}>Disabled</Chip>}
              {data.config?.isHandoff && <Chip icon={ArrowLeftRight} tone="accent" title="Handoff agent — its output picks which branch runs">Handoff</Chip>}
              {cached && <Chip icon={Zap} tone="warning" title="Served from cache">Cached</Chip>}
              {heldBy && <Chip icon={PencilLine} tone="info" title={`${heldBy.name || 'Someone'} is editing this node`}>{(heldBy.name || 'Someone').split(' ')[0]} editing</Chip>}
              {data.locked && <Chip icon={Lock} tone="neutral" title="Adding or editing code needs the code:author permission">Locked</Chip>}
            </div>
          )}
        </div>
      </div>

      {(data.progress || data.childCount > 0 || (status && status !== 'pending')) && (
        <div className="flex items-center gap-2 rounded-b-card border-t border-default bg-bg-subtle/60 px-3.5 py-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
          {status && (
            <span>
              {data.skipReason === 'disabled' ? 'disabled · passed through' : status === 'handled' ? 'failed' : (STATUS_META[status]?.label || status)}
            </span>
          )}
          {status === 'handled' && <span className="rounded bg-warning-subtle px-1 text-[9px] text-warning-subtle-fg">handled</span>}
          {waiting && <span className="normal-case">· waiting for a slot</span>}
          {data.durationMs !== undefined && status && status !== 'running' && (
            <span className="normal-case tabular-nums">{formatMs(data.durationMs)}</span>
          )}
          {data.progress && (
            <span className="ml-auto normal-case tabular-nums text-success" title="Iterations finished">
              {data.progress.done} / {data.progress.total}
            </span>
          )}
          {data.childCount > 0 && (
            <span className="flex items-center gap-0.5 normal-case text-info">
              <WorkflowIcon className="h-2.5 w-2.5" aria-hidden="true" /> {data.childCount} child run{data.childCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {allOutputs.map((h) => (
        <OutputHandle
          key={h.id || 'default'}
          nodeId={id}
          handle={h}
          labeled={Boolean(sourceHandles) || h.id === 'error'}
          reveal={hover || selected}
          showPlus={hover && !readOnly && !renaming}
        />
      ))}
    </div>
  );
}

function Chip({ icon: Icon, tone, title, testId, children }) {
  const tones = {
    neutral: 'bg-bg-subtle text-muted ring-[rgb(var(--border))] dark:ring-white/10',
    accent: 'bg-accent-subtle text-accent-subtle-fg ring-accent/20',
    warning: 'bg-warning-subtle text-warning-subtle-fg ring-warning/25',
    info: 'bg-info-subtle text-info-subtle-fg ring-info/25',
  };
  return (
    <span title={title} data-testid={testId} className={cx('inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium ring-1 ring-inset', tones[tone])}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * A source handle, its label for multi-output nodes (true/false, approved/
 * rejected, error), and the hover "+" that adds the next node already wired
 * to this handle.
 */
function OutputHandle({ nodeId, handle, labeled, reveal, showPlus }) {
  const top = handle.style?.top || '50%';
  const label = handle.label || handle.title || handle.id;
  // A connected branch already has its label on the edge chip; repeating it in
  // the node only crowds the title. Shown on hover/selection, or while the
  // branch still needs wiring.
  const connected = useWorkflowStore((s) => s.edges.some((e) => e.source === nodeId && (e.sourceHandle || null) === (handle.id || null)));
  const showLabel = labeled && label && (reveal || (!connected && handle.id !== 'error'));
  function add(e) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    useCanvasUi.getState().requestAdd({
      kind: 'connect',
      screen: { x: r.right + 4, y: r.top + r.height / 2 },
      from: { nodeId, handleId: handle.id, handleType: 'source' },
    });
  }
  return (
    <>
      <Handle
        type="source"
        position={Position.Right}
        id={handle.id || undefined}
        style={handle.style}
        title={handle.title}
        className="!h-3 !w-3"
      />
      {showLabel && (
        <span
          className="pointer-events-none absolute right-3.5 -translate-y-1/2 rounded bg-surface/90 px-1 text-[11px] font-medium lowercase text-muted"
          style={{ top }}
          aria-hidden="true"
        >
          {String(label).toLowerCase()}
        </span>
      )}
      {showPlus && (
        <button
          type="button"
          onClick={add}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label={`Add a node after this${labeled && label ? ` (${label})` : ''}`}
          data-testid={`quick-add-${nodeId}${handle.id ? `-${handle.id}` : ''}`}
          className="nodrag nopan absolute -right-9 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-default bg-surface text-muted shadow-sm transition-colors hover:border-accent hover:bg-accent hover:text-accent-fg"
          style={{ top }}
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </>
  );
}

/** Inline rename on the node (F2 / "Rename"): Enter or blur saves, Escape cancels. */
function RenameInput({ id, label }) {
  const [value, setValue] = useState(label);
  const ref = useRef(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  function finish(save) {
    if (done.current) return;
    done.current = true;
    const next = value.trim();
    if (save && next && next !== label) useWorkflowStore.getState().updateNodeConfig(id, { label: next });
    useCanvasUi.getState().stopRename();
  }
  return (
    <input
      ref={ref}
      value={value}
      data-testid={`rename-${id}`}
      aria-label="Node name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
      className="nodrag nopan h-6 w-full min-w-0 rounded border border-accent bg-surface px-1 text-[14px] font-semibold text-fg outline-none ring-2 ring-accent/20"
    />
  );
}

export default memo(BaseNode);

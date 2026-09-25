import { Handle, Position } from 'reactflow';
import { Lock, Zap, ArrowLeftRight, Workflow as WorkflowIcon } from 'lucide-react';
import { NODE_STYLES, STATUS_RING, ERROR_COLOR } from './nodeStyles';
import NodeTypeIcon from '../ui/NodeTypeIcon';
import { StatusIcon } from '../ui/Badge';
import { STATUS_META } from '../ui/statusMeta';
import ToolNodeSummary from './ToolNodeSummary';
import { cx } from '../ui/cx';

// One-line description under the label for types that aren't tools.
function subtitleFor(type, config = {}) {
  switch (type) {
    case 'agent': return config.tools?.length ? `Agent · ${config.tools.length} tool${config.tools.length === 1 ? '' : 's'}` : 'Agent';
    case 'condition': return config.expression ? String(config.expression) : 'Condition';
    case 'delay': return config.durationMs ? `Wait ${config.durationMs >= 1000 ? `${Math.round(config.durationMs / 1000)}s` : `${config.durationMs}ms`}` : 'Delay';
    case 'loop': return 'For each item';
    case 'merge': return `Merge · ${config.mode || 'all'}`;
    case 'approval': return 'Human approval';
    case 'subworkflow': return 'Runs another workflow';
    case 'transform': return 'Map fields';
    case 'code': return 'JavaScript';
    case 'start': return 'Trigger';
    case 'end': return 'Output';
    default: return NODE_STYLES[type]?.label || type;
  }
}

/**
 * The canvas node card. `errorHandle` adds spec/31's red error source handle
 * on the lower right: the branch taken only after the node has definitively
 * failed.
 */
export default function BaseNode({ type, data, showTarget = true, showSource = true, sourceHandles = null, errorHandle = false }) {
  const style = NODE_STYLES[type] || NODE_STYLES.tool;
  const status = data.runStatus;
  const cached = data.cached;
  // spec/33: waiting for a queue slot is a dashed outline, not a status.
  const waiting = data.waiting && status === 'running';
  const label = data.config?.label || style.label || type;

  return (
    <div
      className={cx(
        'relative w-[232px] overflow-hidden rounded-card border border-default bg-surface shadow-sm transition-shadow hover:shadow-md',
        'before:absolute before:inset-y-0 before:left-0 before:w-[3px]',
        style.accent,
        STATUS_RING[status],
        waiting && '!border-dashed !border-info',
      )}
    >
      {showTarget && <Handle type="target" position={Position.Left} />}
      <div className="flex items-start gap-2.5 px-3 py-2.5 pl-3.5">
        <NodeTypeIcon type={type} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold leading-5 text-fg">{label}</span>
            {data.config?.isHandoff && (
              <span title="Handoff agent — its output picks which branch runs" className="inline-flex shrink-0 items-center gap-0.5 rounded bg-accent-subtle px-1 text-[9px] font-semibold uppercase tracking-wide text-accent-subtle-fg">
                <ArrowLeftRight className="h-2.5 w-2.5" aria-hidden="true" /> handoff
              </span>
            )}
            {data.locked && (
              <Lock className="h-3 w-3 shrink-0 text-subtle" aria-label="Adding or editing code needs the code:author permission" />
            )}
            {cached && <Zap className="h-3 w-3 shrink-0 text-warning" aria-label="Served from cache" />}
            {status && status !== 'pending' && <StatusIcon status={status} className="ml-auto h-3.5 w-3.5 shrink-0" />}
          </div>
          {type === 'tool' ? <ToolNodeSummary data={data} /> : (
            <p className="truncate text-xs text-subtle" title={subtitleFor(type, data.config)}>{subtitleFor(type, data.config)}</p>
          )}
        </div>
      </div>
      {(data.progress || data.childCount > 0 || status) && (
        <div className="flex items-center gap-2 border-t border-default bg-bg-subtle/50 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-subtle">
          {status && (
            <span>
              {status === 'handled' ? 'failed' : (STATUS_META[status]?.label || status)}
            </span>
          )}
          {status === 'handled' && <span className="rounded bg-warning-subtle px-1 text-[9px] text-warning-subtle-fg">handled</span>}
          {waiting && <span className="normal-case">· waiting for a slot</span>}
          {data.progress && (
            <span className="ml-auto normal-case tabular-nums text-teal-600 dark:text-teal-300" title="Iterations finished">
              {data.progress.done} / {data.progress.total}
            </span>
          )}
          {data.childCount > 0 && (
            <span className="flex items-center gap-0.5 normal-case text-blue-600 dark:text-blue-300">
              <WorkflowIcon className="h-2.5 w-2.5" aria-hidden="true" /> {data.childCount} child run{data.childCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}
      {sourceHandles ? (
        sourceHandles.map((h) => (
          <Handle key={h.id} type="source" position={Position.Right} id={h.id} style={h.style} title={h.title} />
        ))
      ) : showSource ? (
        <Handle type="source" position={Position.Right} style={errorHandle ? { top: '40%' } : undefined} />
      ) : null}
      {errorHandle && (
        <Handle
          type="source"
          position={Position.Right}
          id="error"
          title="Error branch — taken only after the node has definitively failed"
          style={{ top: '80%', background: ERROR_COLOR, borderColor: ERROR_COLOR }}
        />
      )}
    </div>
  );
}

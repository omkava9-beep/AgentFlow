import { Handle, Position } from 'reactflow';
import { NODE_STYLES, STATUS_RING, ERROR_COLOR } from './nodeStyles';
import ToolNodeSummary from './ToolNodeSummary';

/**
 * `errorHandle` adds spec/31's red error source handle on the lower right: the
 * branch taken only after the node has definitively failed.
 */
export default function BaseNode({ type, data, showTarget = true, showSource = true, sourceHandles = null, errorHandle = false }) {
  const style = NODE_STYLES[type] || NODE_STYLES.tool;
  const status = data.runStatus;
  const cached = data.cached;
  // spec/33: waiting for a queue slot is a dashed outline, not a status.
  const waiting = data.waiting && status === 'running';

  return (
    <div
      className={`relative min-w-[160px] rounded-lg border-2 px-3 py-2 shadow-sm ${style.accent} ${STATUS_RING[status] || ''} ${waiting ? '!border-dashed' : ''}`}
    >
      {showTarget && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
        <span>{style.icon}</span>
        <span className="truncate">{data.config?.label || type}</span>
        {data.config?.isHandoff && (
          <span
            title="Handoff agent — its output picks which branch runs"
            className="shrink-0 rounded bg-brand-600 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white"
          >
            ⇄ handoff
          </span>
        )}
        {data.locked && (
          <span title="Adding or editing code needs the code:author permission" className="text-xs">🔒</span>
        )}
        {cached && <span title="Served from cache" className="text-xs">⚡</span>}
      </div>
      {type === 'tool' && <ToolNodeSummary data={data} />}
      {data.progress && (
        <div className="mt-1 text-[11px] font-medium text-teal-700 dark:text-teal-300" title="Iterations finished">
          {data.progress.done} / {data.progress.total}
        </div>
      )}
      {data.childCount > 0 && (
        <div className="mt-0.5 text-[10px] text-indigo-600 dark:text-indigo-300">↗ {data.childCount} child run{data.childCount === 1 ? '' : 's'}</div>
      )}
      {status && (
        <div className="mt-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {status === 'handled' ? 'failed' : status}
          {status === 'handled' && (
            <span className="rounded bg-amber-100 px-1 text-[9px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">handled</span>
          )}
          {waiting && <span className="normal-case">· waiting for a slot</span>}
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
          style={{ top: '82%', background: ERROR_COLOR, borderColor: ERROR_COLOR }}
        />
      )}
    </div>
  );
}

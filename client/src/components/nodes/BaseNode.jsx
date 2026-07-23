import { Handle, Position } from 'reactflow';
import { NODE_STYLES, STATUS_RING } from './nodeStyles';

export default function BaseNode({ type, data, showTarget = true, showSource = true, sourceHandles = null }) {
  const style = NODE_STYLES[type];
  const status = data.runStatus;
  const cached = data.cached;

  return (
    <div
      className={`min-w-[160px] rounded-lg border-2 px-3 py-2 shadow-sm ${style.accent} ${STATUS_RING[status] || ''}`}
    >
      {showTarget && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
        <span>{style.icon}</span>
        <span className="truncate">{data.config?.label || type}</span>
        {cached && <span title="Served from cache" className="text-xs">⚡</span>}
      </div>
      {data.config?.toolType && (
        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{data.config.toolType}</div>
      )}
      {status && (
        <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {status}
        </div>
      )}
      {sourceHandles ? (
        sourceHandles.map((h) => (
          <Handle key={h.id} type="source" position={Position.Right} id={h.id} style={h.style} />
        ))
      ) : showSource ? (
        <Handle type="source" position={Position.Right} />
      ) : null}
    </div>
  );
}

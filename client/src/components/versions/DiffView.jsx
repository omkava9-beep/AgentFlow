import { useEffect, useMemo, useState } from 'react';
import Select from '../ui/Select';
import { Checkbox } from '../ui/Form';
import ReactFlow, { Background, Controls } from 'reactflow';
import { diffVersions, getVersion, listVersions } from '../../api/workflows';
import { apiErrorMessage } from '../../api/client';
import { nodeTypes } from '../nodes';

const ADDED = '#22c55e';
const REMOVED = '#ef4444';
const CHANGED = '#f59e0b';
const MOVED = '#3b82f6';

const outline = (color, dashed = false) => ({ outline: `3px ${dashed ? 'dashed' : 'solid'} ${color}`, outlineOffset: 3, borderRadius: 12 });
const withLabel = (node, prefix) => ({
  ...node,
  data: { ...node.data, config: { ...(node.data?.config || {}), label: `${prefix} ${node.data?.config?.label || node.id}` } },
});
const getAt = (obj, path) => path.reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), obj);
const show = (v) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v, null, 1));

/**
 * spec/30 §5 diff mode: both graphs on one read-only canvas. Added = green "+",
 * removed = red dashed ghosts at their old position, changed = amber "~" (click
 * for before/after), moves behind "Show layout changes". `from === to` is a
 * plain read-only view of one version.
 */
export default function DiffView({ workflowId, from, to, onChangeRange, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [versions, setVersions] = useState([]);
  const [showLayout, setShowLayout] = useState(false);
  const [inspect, setInspect] = useState(null);
  const viewOnly = from === to;

  useEffect(() => {
    listVersions(workflowId).then(setVersions).catch(() => {});
  }, [workflowId]);

  useEffect(() => {
    setData(null);
    setError('');
    setInspect(null);
    const load = viewOnly
      ? getVersion(workflowId, from).then((v) => ({ to: v, from: v, diff: null }))
      : diffVersions(workflowId, from, to);
    load.then(setData).catch((err) => setError(apiErrorMessage(err, 'Failed to load the comparison')));
  }, [workflowId, from, to, viewOnly]);

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };
    const d = data.diff;
    if (!d) return { nodes: data.to.nodes || [], edges: data.to.edges || [] };
    const changed = new Map(d.nodes.changed.map((c) => [c.id, c]));
    const added = new Set(d.nodes.added);
    const moved = new Set(d.nodes.moved);
    const outNodes = (data.to.nodes || []).map((n) => {
      if (added.has(n.id)) return { ...withLabel(n, '+'), style: outline(ADDED) };
      if (changed.has(n.id)) return { ...withLabel(n, '~'), style: outline(CHANGED) };
      if (showLayout && moved.has(n.id)) return { ...n, style: outline(MOVED, true) };
      return n;
    });
    for (const n of data.from.nodes || []) {
      if (d.nodes.removed.includes(n.id)) outNodes.push({ ...withLabel(n, '−'), id: `removed:${n.id}`, style: { ...outline(REMOVED, true), opacity: 0.45 } });
    }
    const edgeAdded = new Set(d.edges.added);
    const edgeChanged = new Set(d.edges.changed.map((c) => c.id));
    const outEdges = (data.to.edges || []).map((e) => {
      if (edgeAdded.has(e.id)) return { ...e, style: { stroke: ADDED, strokeWidth: 2.5 } };
      if (edgeChanged.has(e.id)) return { ...e, style: { stroke: CHANGED, strokeWidth: 2.5 } };
      return e;
    });
    const removedIds = new Set(d.nodes.removed);
    for (const e of data.from.edges || []) {
      if (!d.edges.removed.includes(e.id)) continue;
      outEdges.push({
        ...e,
        id: `removed:${e.id}`,
        source: removedIds.has(e.source) ? `removed:${e.source}` : e.source,
        target: removedIds.has(e.target) ? `removed:${e.target}` : e.target,
        style: { stroke: REMOVED, strokeWidth: 2, strokeDasharray: '6 4', opacity: 0.6 },
      });
    }
    return { nodes: outNodes, edges: outEdges };
  }, [data, showLayout]);

  function onNodeClick(_, node) {
    const change = data?.diff?.nodes?.changed?.find((c) => c.id === node.id);
    if (!change) return setInspect(null);
    const before = data.from.nodes.find((n) => n.id === node.id);
    const after = data.to.nodes.find((n) => n.id === node.id);
    const read = (n, path) => (path[0] === 'type' ? n?.type : path[0] === 'data' ? getAt(n?.data, path.slice(1)) : getAt(n?.data?.config, path));
    setInspect({
      label: after?.data?.config?.label || node.id,
      rows: change.paths.map((p) => ({ path: p.join('.'), before: read(before, p), after: read(after, p) })),
    });
  }

  const options = [...versions.map((v) => ({ value: v.version, label: `v${v.version}${v.isLive ? ' (live)' : ''}` })), { value: 'draft', label: 'Draft' }];
  const pick = (which) => (e) => {
    const value = e.target.value === 'draft' ? 'draft' : Number(e.target.value);
    onChangeRange(which === 'from' ? { from: value, to } : { from, to: value });
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-default px-4 py-2 text-xs">
        <span className="font-semibold text-fg">{viewOnly ? `Viewing v${from} (read-only)` : 'Compare'}</span>
        {!viewOnly && (
          <>
            <Select size="sm" className="w-40" aria-label="Compare from" value={from} onChange={pick('from')}>
              {options.filter((o) => o.value !== 'draft').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <span>↔</span>
            <Select size="sm" className="w-40" aria-label="Compare to" value={to} onChange={pick('to')}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Legend color={ADDED} text="added" />
            <Legend color={REMOVED} text="removed" dashed />
            <Legend color={CHANGED} text="changed" />
            <Checkbox
              size="sm"
              label={`Show layout changes${data?.diff?.nodes?.moved?.length ? ` (${data.diff.nodes.moved.length})` : ''}`}
              checked={showLayout}
              onChange={(e) => setShowLayout(e.target.checked)}
            />
            {data?.diff?.nameChanged && <span className="text-warning">renamed: “{data.from.name}” → “{data.to.name}”</span>}
          </>
        )}
        <button type="button" onClick={onClose} className="ml-auto rounded-lg border border-default px-3 py-1 font-medium">Back to draft</button>
      </div>
      {error && <p className="p-4 text-sm text-danger">{error}</p>}
      <div className="relative flex-1">
        {data && (
          <ReactFlow
            key={`${from}-${to}`}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            className="rf-readonly"
            onNodeClick={onNodeClick}
            fitView
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
        {inspect && (
          <div className="absolute right-3 top-3 z-10 w-80 rounded-xl border border-warning/30 bg-surface p-3 text-xs shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">“{inspect.label}” changed</span>
              <button type="button" onClick={() => setInspect(null)} className="text-subtle">✕</button>
            </div>
            {inspect.rows.map((r) => (
              <div key={r.path} className="mb-2">
                <p className="font-mono text-[11px] text-muted">{r.path}</p>
                <p className="whitespace-pre-wrap break-words rounded bg-danger-subtle px-2 py-1 text-danger-subtle-fg">− {show(r.before)}</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words rounded bg-success-subtle px-2 py-1 text-success-subtle-fg">+ {show(r.after)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({ color, text, dashed = false }) {
  return (
    <span className="flex items-center gap-1 text-muted">
      <span className="inline-block h-3 w-3 rounded" style={{ border: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }} /> {text}
    </span>
  );
}

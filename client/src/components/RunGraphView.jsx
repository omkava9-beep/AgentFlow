import { useCallback, useEffect, useMemo, useRef } from 'react';
import ReactFlow, { Background, Controls, useNodesState, useEdgesState } from 'reactflow';
import 'reactflow/dist/style.css';
import { nodeTypes } from './nodes';
import { ERROR_COLOR } from './nodes/nodeStyles';
import { frameOnInit } from '../utils/frameGraph';

const TAKEN_EDGE = { stroke: '#6366f1', strokeWidth: 3 };
const PRUNED_EDGE = { stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.45 };
// spec/31 §7: error branches are always red and dashed; taken ones animate.
const ERROR_EDGE = { stroke: ERROR_COLOR, strokeWidth: 1.5, strokeDasharray: '6 4' };
const TAKEN_ERROR_EDGE = { stroke: ERROR_COLOR, strokeWidth: 3, strokeDasharray: '6 4' };

/**
 * Which branch a run actually took, per edge (spec/16, spec/09).
 *
 * A handoff agent and a condition node both resolve to exactly one outgoing
 * edge, so they get the same treatment: the taken edge is animated and accented,
 * the ruled-out ones dashed and faded. Without this, a dynamic routing decision
 * is invisible on the graph — the untaken nodes just go grey and you can't tell
 * whether that was a routing choice or a failure upstream.
 */
function branchStateFor(edge, sourceNode, sourceResult) {
  if (!sourceNode || !sourceResult) return null;

  if (edge.sourceHandle === 'error') {
    if (sourceResult.handled) return 'taken-error';
    return ['success', 'failed', 'skipped'].includes(sourceResult.status) ? 'pruned-error' : 'error';
  }

  if (sourceNode.data?.config?.isHandoff) {
    if (!sourceResult.handoffTarget) return null;
    return edge.label === sourceResult.handoffTarget ? 'taken' : 'pruned';
  }

  if (sourceNode.type === 'condition') {
    const taken = sourceResult.output?.taken;
    if (typeof taken !== 'boolean') return null;
    return edge.sourceHandle === (taken ? 'true' : 'false') ? 'taken' : 'pruned';
  }

  return null;
}

export default function RunGraphView({ workflow, nodeResults }) {
  const resultsByNodeId = useMemo(() => new Map((nodeResults || []).map((r) => [r.nodeId, r])), [nodeResults]);
  const nodesById = useMemo(() => new Map((workflow?.nodes || []).map((n) => [n.id, n])), [workflow]);

  const decoratedNodes = useMemo(
    () =>
      (workflow?.nodes || []).map((n) => {
        const result = resultsByNodeId.get(n.id);
        return {
          ...n,
          data: {
            ...n.data,
            // A handled failure shows amber with a chip, not red (spec/31).
            runStatus: result?.handled ? 'handled' : result?.status,
            cached: result?.cached,
            runMode: result?.mode || null,
            waiting: result?.waiting,
            progress: result?.progress || null,
            childCount: result?.childRunIds?.length || 0,
            // A node switched off in the builder: shown as "disabled · passed through".
            skipReason: result?.skipReason || null,
            durationMs: result?.durationMs,
          },
        };
      }),
    [workflow, resultsByNodeId]
  );

  const decoratedEdges = useMemo(
    () =>
      (workflow?.edges || []).map((e) => {
        const state = branchStateFor(e, nodesById.get(e.source), resultsByNodeId.get(e.source));
        if (state === 'taken-error') return { ...e, animated: true, style: TAKEN_ERROR_EDGE };
        if (state === 'pruned-error') return { ...e, style: { ...ERROR_EDGE, opacity: 0.35 } };
        if (state === 'error' || (!state && e.sourceHandle === 'error')) return { ...e, style: ERROR_EDGE };
        if (state === 'taken') {
          return { ...e, animated: true, style: TAKEN_EDGE, labelStyle: { fill: '#6366f1', fontWeight: 600 } };
        }
        if (state === 'pruned') {
          return { ...e, style: PRUNED_EDGE, labelStyle: { opacity: 0.5 } };
        }
        return e;
      }),
    [workflow, nodesById, resultsByNodeId]
  );

  const box = useRef(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frame = useCallback(frameOnInit(() => box.current, { minZoom: 0.7 }), []);
  const [nodes, setNodes] = useNodesState(decoratedNodes);
  const [edges, setEdges] = useEdgesState(decoratedEdges);

  useEffect(() => setNodes(decoratedNodes), [decoratedNodes, setNodes]);
  useEffect(() => setEdges(decoratedEdges), [decoratedEdges, setEdges]);

  return (
    <div ref={box} className="h-full w-full">
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      // This view is always read-only - the run monitor and the shared page.
      // React Flow still marks handles `connectable`, so neutralise them here
      // rather than leave a connection affordance the view can't honour.
      className="rf-readonly"
      // Legible first frame (small graphs centred, big ones start at the
      // trigger and pan) rather than fitView's shrink-to-thumbnail.
      onInit={frame}
      minZoom={0.25}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
    </div>
  );
}

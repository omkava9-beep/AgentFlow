import { useEffect, useMemo } from 'react';
import ReactFlow, { Background, Controls, useNodesState, useEdgesState } from 'reactflow';
import 'reactflow/dist/style.css';
import { nodeTypes } from './nodes';

const TAKEN_EDGE = { stroke: '#6366f1', strokeWidth: 3 };
const PRUNED_EDGE = { stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.45 };

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
          data: { ...n.data, runStatus: result?.status, cached: result?.cached },
        };
      }),
    [workflow, resultsByNodeId]
  );

  const decoratedEdges = useMemo(
    () =>
      (workflow?.edges || []).map((e) => {
        const state = branchStateFor(e, nodesById.get(e.source), resultsByNodeId.get(e.source));
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

  const [nodes, setNodes] = useNodesState(decoratedNodes);
  const [edges, setEdges] = useEdgesState(decoratedEdges);

  useEffect(() => setNodes(decoratedNodes), [decoratedNodes, setNodes]);
  useEffect(() => setEdges(decoratedEdges), [decoratedEdges, setEdges]);

  return (
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
      fitView
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

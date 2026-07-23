import { useEffect, useMemo } from 'react';
import ReactFlow, { Background, Controls, useNodesState, useEdgesState } from 'reactflow';
import 'reactflow/dist/style.css';
import { nodeTypes } from './nodes';

export default function RunGraphView({ workflow, nodeResults }) {
  const resultsByNodeId = useMemo(() => new Map((nodeResults || []).map((r) => [r.nodeId, r])), [nodeResults]);

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

  const [nodes, setNodes] = useNodesState(decoratedNodes);
  const [edges, setEdges] = useEdgesState(workflow?.edges || []);

  useEffect(() => setNodes(decoratedNodes), [decoratedNodes, setNodes]);
  useEffect(() => setEdges(workflow?.edges || []), [workflow, setEdges]);

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} fitView>
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

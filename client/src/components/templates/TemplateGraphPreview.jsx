import { useCallback, useMemo, useRef } from 'react';
import ReactFlow, { Background, Controls } from 'reactflow';
import { nodeTypes } from '../nodes';
import { frameOnInit } from '../../utils/frameGraph';

const MIN_LEGIBLE_ZOOM = 0.75;
const PAD = 24;

/**
 * A read-only look at a template's graph before you use it. Small graphs fit;
 * a long chain would shrink to an unreadable thumbnail, so instead it opens at
 * a legible zoom anchored on the left - where the trigger is - and you drag or
 * scroll to follow it.
 */
export default function TemplateGraphPreview({ nodes = [], edges = [], className = 'h-80' }) {
  const box = useRef(null);
  const flowNodes = useMemo(() => nodes.map((n) => ({ ...n, draggable: false, selectable: false })), [nodes]);
  const flowEdges = useMemo(() => edges.map((e) => ({ ...e, type: e.type || 'smoothstep' })), [edges]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frame = useCallback(frameOnInit(() => box.current, { minZoom: MIN_LEGIBLE_ZOOM, pad: PAD }), []);

  return (
    <div ref={box} className={`overflow-hidden rounded-card border border-default bg-bg-subtle/40 ${className}`} data-testid="template-graph-preview">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        className="rf-readonly"
        onInit={frame}
        minZoom={0.2}
        maxZoom={1.4}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}

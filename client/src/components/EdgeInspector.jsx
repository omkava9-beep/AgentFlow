import { X, ArrowRight, SplitSquareHorizontal, Trash2, Lock } from 'lucide-react';
import { useWorkflowStore, isConditionEdge } from '../store/workflowStore';
import { Field, Input, Select } from './ui/Form';
import Button from './ui/Button';
import NodeTypeIcon from './ui/NodeTypeIcon';
import { useCanvasUi } from './canvas/canvasUiStore';

const BRANCH_HANDLES = { true: 'true', false: 'false', approved: 'approved', rejected: 'rejected', error: 'error' };

/**
 * Edge details (spec/20): what it connects, its label (free text, a handoff
 * candidate, or fixed by a branch handle), and the same actions as its
 * right-click menu. Phase 1 set a label once at connect time and gave no way to
 * change it — which blocks spec/16, where a handoff agent's outgoing edge labels
 * have to match its candidate list.
 */
export default function EdgeInspector({ readOnly = false, onInsert = null }) {
  const { edges, nodes, selectedEdgeId, selectEdge, setEdgeLabel, deleteEdge } = useWorkflowStore();
  const width = useCanvasUi((s) => s.inspectorWidth);
  const edge = edges.find((e) => e.id === selectedEdgeId);
  if (!edge) return null;

  const source = nodes.find((n) => n.id === edge.source);
  const target = nodes.find((n) => n.id === edge.target);
  const nodeLabel = (n) => n?.data?.config?.label || n?.id || '?';

  const branch = BRANCH_HANDLES[edge.sourceHandle] || (isConditionEdge(edge) ? edge.label : null);
  const handoffCandidates =
    source?.type === 'agent' && source.data?.config?.isHandoff ? source.data.config.candidates || [] : null;

  return (
    <aside data-testid="edge-inspector" style={{ width }} className="flex h-full shrink-0 flex-col border-l border-default bg-surface" aria-label="Connection settings">
      <div className="flex shrink-0 items-center justify-between border-b border-default px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">Connection</h3>
          <p className="text-xs text-subtle">{branch ? `${branch} branch` : edge.label ? `Label “${edge.label}”` : 'Unlabelled'}</p>
        </div>
        <button onClick={() => selectEdge(null)} aria-label="Close panel" className="rounded-control p-1 text-subtle hover:bg-bg-subtle hover:text-fg">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div className="flex items-center gap-2 rounded-control border border-default bg-bg-subtle/60 p-2.5 text-sm">
          <Endpoint node={source} label={nodeLabel(source)} />
          <ArrowRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
          <Endpoint node={target} label={nodeLabel(target)} />
        </div>

        <fieldset disabled={readOnly} className="min-w-0 space-y-4">
          {branch ? (
            <Field label="Label" help="Branch edges are routed by their handle, not by their label — renaming this would be a lie.">
              <div className="flex h-8 items-center gap-2 rounded-control border border-default bg-surface-sunken px-2.5 text-sm text-muted">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" /> {branch}
              </div>
            </Field>
          ) : handoffCandidates ? (
            <Field label="Handoff target" help="Options come from the source agent’s candidate list, so labels and candidates stay in sync.">
              <Select
                value={edge.label || ''}
                onValueChange={(v) => setEdgeLabel(edge.id, v)}
                placeholder="Select a candidate…"
                options={handoffCandidates.map((c) => ({ value: c, label: c }))}
              />
            </Field>
          ) : (
            <Field label="Label" help="Optional. Handoff agents pick a branch by label.">
              <Input
                value={edge.label || ''}
                placeholder="(unlabelled)"
                data-testid="edge-label-input"
                onChange={(e) => setEdgeLabel(edge.id, e.target.value)}
              />
            </Field>
          )}
        </fieldset>

        {!readOnly && (
          <div className="flex flex-col gap-2">
            {onInsert && (
              <Button variant="secondary" onClick={() => onInsert(edge.id)}>
                <SplitSquareHorizontal className="h-4 w-4" aria-hidden="true" /> Insert node here
              </Button>
            )}
            <Button variant="danger" onClick={() => deleteEdge(edge.id)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete edge
            </Button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-default px-4 py-2.5">
        <Button variant="secondary" className="w-full" onClick={() => selectEdge(null)}>Done</Button>
      </div>
    </aside>
  );
}

function Endpoint({ node, label }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      {node && <NodeTypeIcon type={node.type} size="sm" />}
      <span className="truncate text-fg">{label}</span>
    </span>
  );
}

import { useWorkflowStore, isConditionEdge } from '../store/workflowStore';
import { TextField, Select, Button } from './ui';

/**
 * Edge label editing (spec/20). Phase 1 set a label once at connect time and gave
 * no way to change it — which blocks spec/16, where a handoff agent's outgoing
 * edge labels have to match its candidate list.
 */
export default function EdgeInspector() {
  const { edges, nodes, selectedEdgeId, selectEdge, setEdgeLabel, deleteSelection } = useWorkflowStore();
  const edge = edges.find((e) => e.id === selectedEdgeId);
  if (!edge) return null;

  const source = nodes.find((n) => n.id === edge.source);
  const target = nodes.find((n) => n.id === edge.target);
  const nodeLabel = (n) => n?.data?.config?.label || n?.id || '?';

  const locked = isConditionEdge(edge);
  const handoffCandidates =
    source?.type === 'agent' && source.data?.config?.isHandoff ? source.data.config.candidates || [] : null;

  function removeEdge() {
    // Route through the normal selection delete so it lands in the undo stack.
    useWorkflowStore.setState({ edges: edges.map((e) => ({ ...e, selected: e.id === edge.id })) });
    deleteSelection();
  }

  return (
    <div className="fixed right-0 top-[57px] h-[calc(100vh-57px)] w-80 overflow-y-auto border-l border-slate-200/80 bg-white/90 p-4 shadow-lg backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/85">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Configure edge</h3>
        <button onClick={() => selectEdge(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          ✕
        </button>
      </div>

      <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
        {nodeLabel(source)} <span className="text-slate-400">→</span> {nodeLabel(target)}
      </p>

      <div className="space-y-4">
        {locked ? (
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Label</span>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              {edge.label}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Condition branches are matched by handle, not by label — renaming this would be a lie.
            </p>
          </div>
        ) : handoffCandidates ? (
          <>
            <Select label="Handoff target" value={edge.label || ''} onChange={(e) => setEdgeLabel(edge.id, e.target.value)}>
              <option value="">Select a candidate...</option>
              {handoffCandidates.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <p className="text-xs text-slate-400">
              Options come from the source agent's candidate list, so labels and candidates stay in sync.
            </p>
          </>
        ) : (
          <>
            <TextField
              label="Label"
              value={edge.label || ''}
              placeholder="(unlabelled)"
              onChange={(e) => setEdgeLabel(edge.id, e.target.value)}
            />
            <p className="text-xs text-slate-400">Optional. Used by handoff agents to pick a branch.</p>
          </>
        )}

        <Button variant="danger" className="w-full" onClick={removeEdge}>
          Delete edge
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => selectEdge(null)}>
          Done
        </Button>
      </div>
    </div>
  );
}

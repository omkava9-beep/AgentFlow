import { useWorkflowStore } from '../store/workflowStore';

/**
 * Candidate list editor for a handoff agent (spec/16). The candidate names are
 * what the engine matches outgoing edge labels against, so this panel shows the
 * live edge state per candidate — a name with no matching edge routes nowhere,
 * and that's worth seeing here rather than only in the validation panel.
 */
export default function HandoffCandidates({ nodeId }) {
  const { nodes, edges, addHandoffCandidate, removeHandoffCandidate, renameHandoffCandidate } = useWorkflowStore();
  const node = nodes.find((n) => n.id === nodeId);
  const candidates = node?.data?.config?.candidates || [];
  const outgoingLabels = edges.filter((e) => e.source === nodeId).map((e) => e.label);
  const unmatchedEdges = outgoingLabels.filter((l) => !candidates.includes(l));

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Handoff candidates</span>
        <button
          type="button"
          onClick={() => addHandoffCandidate(nodeId)}
          className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          + Add
        </button>
      </div>

      {candidates.length === 0 && (
        <p className="text-xs text-slate-400">
          No candidates yet. Add one per outgoing branch, then label each edge with a candidate name.
        </p>
      )}

      {candidates.map((candidate, index) => {
        const wired = outgoingLabels.includes(candidate);
        return (
          <div key={index} className="flex items-center gap-1.5">
            <span
              title={wired ? 'An outgoing edge is labelled with this name' : 'No outgoing edge uses this name yet'}
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${wired ? 'bg-green-500' : 'bg-amber-500'}`}
            />
            <input
              value={candidate}
              onChange={(e) => renameHandoffCandidate(nodeId, index, e.target.value)}
              className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={() => removeHandoffCandidate(nodeId, index)}
              title="Remove candidate"
              className="shrink-0 px-1 text-slate-400 hover:text-red-500"
            >
              ✕
            </button>
          </div>
        );
      })}

      <p className="text-xs text-slate-400">
        Renaming a candidate renames any edge already labelled with it.
      </p>

      {unmatchedEdges.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Edge label{unmatchedEdges.length > 1 ? 's' : ''} with no candidate: {unmatchedEdges.map((l) => l || '(unlabelled)').join(', ')}
        </p>
      )}
    </div>
  );
}

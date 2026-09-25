import { X } from 'lucide-react';
import { useWorkflowStore } from '../store/workflowStore';
import { Tooltip } from './ui/index';

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
    <div className="space-y-2 rounded-lg border border-default p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-subtle">Handoff candidates</span>
        <button
          type="button"
          onClick={() => addHandoffCandidate(nodeId)}
          className="text-xs font-medium text-accent hover:underline"
        >
          + Add
        </button>
      </div>

      {candidates.length === 0 && (
        <p className="text-xs text-subtle">
          No candidates yet. Add one per outgoing branch, then label each edge with a candidate name.
        </p>
      )}

      {candidates.map((candidate, index) => {
        const wired = outgoingLabels.includes(candidate);
        return (
          <div key={index} className="flex items-center gap-1.5">
            <span
              title={wired ? 'An outgoing edge is labelled with this name' : 'No outgoing edge uses this name yet'}
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${wired ? 'bg-success' : 'bg-warning'}`}
            />
            <input
              value={candidate}
              onChange={(e) => renameHandoffCandidate(nodeId, index, e.target.value)}
              className="min-w-0 flex-1 rounded border border-default bg-surface px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none"
            />
            <Tooltip content={"Remove candidate"}>
              <button aria-label={"Remove candidate"}
              type="button"
              onClick={() => removeHandoffCandidate(nodeId, index)}
              className="shrink-0 px-1 text-subtle hover:text-danger"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            </Tooltip>
          </div>
        );
      })}

      <p className="text-xs text-subtle">
        Renaming a candidate renames any edge already labelled with it.
      </p>

      {unmatchedEdges.length > 0 && (
        <p className="text-xs text-warning">
          Edge label{unmatchedEdges.length > 1 ? 's' : ''} with no candidate: {unmatchedEdges.map((l) => l || '(unlabelled)').join(', ')}
        </p>
      )}
    </div>
  );
}

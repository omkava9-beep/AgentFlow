import { useParams } from 'react-router-dom';
import { useWorkspacePath } from '../../hooks/useWorkspacePath';
import MappingTable from './MappingTable';
import WorkflowPicker from './WorkflowPicker';
import { useWorkspaceWorkflows } from '../../hooks/useWorkspaceWorkflows';

export default function SubworkflowPanel({ config, set }) {
  const { id: currentId } = useParams();
  const wp = useWorkspacePath();
  const { workflows } = useWorkspaceWorkflows();
  const mapping = config.inputMapping || [];

  return (
    <>
      <WorkflowPicker label="Workflow" value={config.workflowId} onChange={(workflowId) => set({ workflowId })} workflows={workflows} excludeId={currentId} />
      {config.workflowId && (
        <a href={wp(`/workflows/${config.workflowId}`)} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
          Open workflow ↗
        </a>
      )}
      <div>
        <span className="mb-1 block text-sm font-medium text-fg">Input mapping (optional)</span>
        <MappingTable rows={mapping} onChange={(inputMapping) => set({ inputMapping })} />
        {!mapping.length && <p className="mt-1 text-xs text-subtle">No mapping: this node's input is passed through as the child's Start output.</p>}
      </div>
      <p className="text-xs text-subtle">
        Runs the chosen workflow as a child run and outputs its End result. Same workspace only; recursion stops at depth 5.
      </p>
    </>
  );
}

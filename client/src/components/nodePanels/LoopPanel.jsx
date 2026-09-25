import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { createWorkflow, updateWorkflow } from '../../api/workflows';
import { useWorkspacePath } from '../../hooks/useWorkspacePath';
import { useWorkflowStore } from '../../store/workflowStore';
import { TextField } from '../ui';
import WorkflowPicker from './WorkflowPicker';
import { useWorkspaceWorkflows } from '../../hooks/useWorkspaceWorkflows';

/**
 * spec/31 §4. The body is a separate workflow; "Create body workflow" makes one
 * with Start → End pre-wired and links it, so the reference isn't a chore.
 */
export default function LoopPanel({ config, set, readOnly }) {
  const { id: currentId } = useParams();
  const wp = useWorkspacePath();
  const parentName = useWorkflowStore((s) => s.name);
  const { workflows, reload } = useWorkspaceWorkflows();
  const [creating, setCreating] = useState(false);

  async function createBody() {
    setCreating(true);
    try {
      const wf = await createWorkflow(`${parentName || 'Workflow'} — loop body`);
      await updateWorkflow(wf._id, {
        nodes: [
          { id: 'start', type: 'start', position: { x: 80, y: 120 }, data: { config: { label: 'Start' } } },
          { id: 'end', type: 'end', position: { x: 380, y: 120 }, data: { config: { label: 'End' } } },
        ],
        edges: [{ id: 'start-end', source: 'start', target: 'end' }],
      });
      await reload();
      set({ workflowId: wf._id });
      window.open(wp(`/workflows/${wf._id}`), '_blank', 'noopener');
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <TextField label="Items (template → array)" value={config.itemsPath || ''} placeholder="{{input.orders}}" onChange={(e) => set({ itemsPath: e.target.value })} />
      <WorkflowPicker label="Body workflow" value={config.workflowId} onChange={(workflowId) => set({ workflowId })} workflows={workflows} excludeId={currentId} />
      <div className="flex items-center gap-3 text-xs">
        {!readOnly && (
          <button type="button" onClick={createBody} disabled={creating} className="font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400">
            {creating ? 'Creating…' : '+ Create body workflow'}
          </button>
        )}
        {config.workflowId && (
          <a href={wp(`/workflows/${config.workflowId}`)} target="_blank" rel="noreferrer" className="text-slate-500 hover:underline">
            Open body ↗
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Concurrency" type="number" min="1" max="10" value={config.concurrency ?? 3} onChange={(e) => set({ concurrency: Number(e.target.value) })} />
        <TextField label="Max items" type="number" min="1" max="500" value={config.maxItems ?? 100} onChange={(e) => set({ maxItems: Number(e.target.value) })} />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input type="checkbox" className="accent-brand-500" checked={Boolean(config.continueOnError)} onChange={(e) => set({ continueOnError: e.target.checked })} />
        Continue when an iteration fails
      </label>
      <p className="text-xs text-slate-400">
        Each item runs the body as a child run with <code>{'{ item, index, total, parent }'}</code> as its input. Results come back in
        order as <code>{'{ results, succeeded, failed, total }'}</code>.
      </p>
    </>
  );
}

import { useEffect, useState } from 'react';
import NodeTypeIcon from './ui/NodeTypeIcon';
import { X } from 'lucide-react';
import { useWorkflowStore } from '../store/workflowStore';
import { useIntegrationStore } from '../store/integrationStore';
import { TextField, TextArea, Button } from './ui';
import HandoffCandidates from './HandoffCandidates';
import ToolNodeFields from './ToolNodeFields';
import AgentToolsField from './nodePanels/AgentToolsField';
import { ADVANCED_PANELS } from './nodePanels';
import { useSoftLock } from '../collab/useSoftLock';

/**
 * `readOnly` (viewers, spec/23): fields render disabled rather than hidden, so a
 * viewer can still read how a node is configured.
 */
export default function NodeConfigPanel({ readOnly = false }) {
  const { nodes, selectedNodeId, selectNode, updateNodeConfig } = useWorkflowStore();
  const node = nodes.find((n) => n.id === selectedNodeId);
  // spec/28 §5: opening the panel takes a soft lock on the node's config; while
  // someone else holds it the fields stay live but read-only.
  const lock = useSoftLock(node ? node.id : null, { enabled: !readOnly });
  const loadCatalog = useIntegrationStore((s) => s.loadCatalog);
  const [exprError, setExprError] = useState('');

  useEffect(() => {
    if (node?.type === 'tool' || node?.type === 'agent') loadCatalog();
  }, [node?.type, loadCatalog]);

  if (!node) return null;

  function set(patch) {
    updateNodeConfig(node.id, patch);
  }

  function validateExpression(expr) {
    try {
      // eslint-disable-next-line no-new-func
      new Function('output', `"use strict"; return Boolean(${expr});`);
      setExprError('');
    } catch {
      setExprError('Invalid expression syntax');
    }
  }

  return (
    <div data-testid="node-config-panel" className="h-full w-[340px] shrink-0 overflow-y-auto border-l border-default bg-surface p-4">
      <div className="-mx-4 -mt-4 mb-4 flex items-center gap-2.5 border-b border-default px-4 py-3">
        <NodeTypeIcon type={node.type} size="md" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
          <span className="sr-only">Configure </span>
          <span className="text-2xs font-medium uppercase tracking-wider text-subtle">Configure {node.type}</span>
          <span className="block truncate">{node.data?.config?.label || node.type}</span>
        </h3>
        <button onClick={() => selectNode(null)} aria-label="Close panel" className="rounded-control p-1 text-subtle hover:bg-bg-subtle hover:text-fg"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>

      <div className="space-y-4">
        {lock.readOnly && (
          <div
            data-testid="lock-banner"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
          >
            {lock.released ? (
              <span className="flex items-center justify-between gap-2">
                <span>{lock.heldBy?.name || 'They'} finished.</span>
                <button type="button" onClick={lock.acquire} className="font-semibold underline">
                  Edit now
                </button>
              </span>
            ) : lock.otherTab ? (
              "You're editing this node in another tab."
            ) : (
              `${lock.heldBy?.name || 'Someone'} is editing this node.`
            )}
          </div>
        )}
        {/* min-w-0: a fieldset defaults to min-width: min-content, so one long
            truncated line would otherwise widen the whole panel. */}
        <fieldset disabled={readOnly || lock.readOnly} className="min-w-0 space-y-4">
          {readOnly && (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              Read-only — your role can view this workflow but not change it.
            </p>
          )}
          <TextField
            label="Label"
            value={node.data.config.label || ''}
            onChange={(e) => set({ label: e.target.value })}
          />

          {node.type === 'agent' && (
            <>
              <TextArea
                label="System prompt"
                rows={5}
                value={node.data.config.systemPrompt || ''}
                onChange={(e) => set({ systemPrompt: e.target.value })}
                placeholder="Describe this agent's role and behavior..."
              />
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={Boolean(node.data.config.isHandoff)}
                  onChange={(e) => set({ isHandoff: e.target.checked })}
                  className="accent-brand-500"
                />
                Agent handoff (dynamic delegation)
              </label>
              {node.data.config.isHandoff && (
                <>
                  <p className="text-xs text-slate-400">
                    This agent's output picks which outgoing branch runs; the rest are skipped.
                  </p>
                  <HandoffCandidates nodeId={node.id} />
                </>
              )}
              {/* spec/37 §5: MCP tools and integration actions the agent may call. */}
              <AgentToolsField config={node.data.config} set={set} readOnly={readOnly} />
            </>
          )}

          {node.type === 'tool' && <ToolNodeFields node={node} set={set} readOnly={readOnly} />}

          {node.type === 'condition' && (
            <>
              <TextField
                label="Expression"
                value={node.data.config.expression || ''}
                onChange={(e) => {
                  set({ expression: e.target.value });
                  validateExpression(e.target.value);
                }}
                placeholder="output.length > 100"
              />
              {exprError && <p className="text-xs text-red-500">{exprError}</p>}
              <p className="text-xs text-slate-400">
                Evaluated against the incoming node's <code>output</code>. Must resolve to true/false.
              </p>
            </>
          )}

          {ADVANCED_PANELS[node.type] && (() => {
            // spec/31 node types each own their panel; see components/nodePanels.
            const Panel = ADVANCED_PANELS[node.type];
            return <Panel config={node.data.config} set={set} readOnly={readOnly} />;
          })()}

        </fieldset>
        <Button variant="secondary" className="w-full" onClick={() => selectNode(null)}>
          Done
        </Button>
      </div>
    </div>
  );
}

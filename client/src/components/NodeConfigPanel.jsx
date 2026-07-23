import { useEffect, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { listTools } from '../api/tools';
import { TextField, TextArea, Select, Button } from './ui';
import ComingSoonBadge from './ComingSoonBadge';
import { COMING_SOON_FEATURES } from '../comingSoon';
import { ACTION_TYPES } from '../comingSoonCatalog';

export default function NodeConfigPanel() {
  const { nodes, selectedNodeId, selectNode, updateNodeConfig } = useWorkflowStore();
  const node = nodes.find((n) => n.id === selectedNodeId);
  const [tools, setTools] = useState([]);
  const [exprError, setExprError] = useState('');

  useEffect(() => {
    if (node?.type === 'tool') {
      listTools().then(setTools).catch(() => setTools([]));
    }
  }, [node?.type]);

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
    <div className="fixed right-0 top-[57px] h-[calc(100vh-57px)] w-80 overflow-y-auto border-l border-slate-200/80 bg-white/90 p-4 shadow-lg backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/85">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Configure {node.type}
        </h3>
        <button onClick={() => selectNode(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          ✕
        </button>
      </div>

      <div className="space-y-4">
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
            <label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <input type="checkbox" disabled />
              Agent handoff (dynamic delegation) <ComingSoonBadge />
            </label>
          </>
        )}

        {node.type === 'tool' && (
          <>
            <Select
              label="Tool type"
              value={node.data.config.toolType || ''}
              onChange={(e) => set({ toolType: e.target.value })}
            >
              <option value="">Select an action...</option>
              {tools.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
              {ACTION_TYPES.filter((a) => !a.live).map((a) => (
                <option key={a.type} value="" disabled>
                  {a.label} (coming soon)
                </option>
              ))}
            </Select>
            <div>
              <label className="mb-1 flex items-center text-sm font-medium text-slate-700 dark:text-slate-300">
                Failure rate override {COMING_SOON_FEATURES && <ComingSoonBadge />}
              </label>
              <input type="range" min="0" max="100" disabled className="w-full opacity-50" />
              <p className="mt-1 text-xs text-slate-400">Uses the server's default simulated failure rate for now.</p>
            </div>
          </>
        )}

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

        <Button variant="secondary" className="w-full" onClick={() => selectNode(null)}>
          Done
        </Button>
      </div>
    </div>
  );
}

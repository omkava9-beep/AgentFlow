import { useEffect, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { listTools } from '../api/tools';
import { TextField, TextArea, Select, Button } from './ui';
import MockBehaviorFields from './MockBehaviorFields';
import HandoffCandidates from './HandoffCandidates';
import ToolConfigFields from './ToolConfigFields';

export default function NodeConfigPanel() {
  const { nodes, selectedNodeId, selectNode, updateNodeConfig } = useWorkflowStore();
  const node = nodes.find((n) => n.id === selectedNodeId);
  const [tools, setTools] = useState([]);
  const [toolDefaults, setToolDefaults] = useState(null);
  const [exprError, setExprError] = useState('');

  useEffect(() => {
    if (node?.type === 'tool') {
      listTools()
        .then(({ tools: list, defaults }) => {
          setTools(list);
          setToolDefaults(defaults);
        })
        .catch(() => setTools([]));
    }
  }, [node?.type]);

  if (!node) return null;

  function set(patch) {
    updateNodeConfig(node.id, patch);
  }

  const selectedTool = tools.find((t) => t.type === node?.data?.config?.toolType) || null;
  const unknownToolType =
    node?.type === 'tool' && Boolean(node.data.config.toolType) && tools.length > 0 && !selectedTool;

  function changeToolType(toolType) {
    // Clear the previous type's settings rather than leaving orphaned keys from a
    // schema that no longer applies.
    set({ toolType, toolConfig: {} });
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
          </>
        )}

        {node.type === 'tool' && (
          <>
            <Select
              label="Tool type"
              value={node.data.config.toolType || ''}
              onChange={(e) => changeToolType(e.target.value)}
            >
              <option value="">Select an action...</option>
              {tools.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
              {/* A stored type the registry no longer has stays selectable, so
                  opening the node can't quietly wipe the user's config. */}
              {unknownToolType && (
                <option value={node.data.config.toolType}>{node.data.config.toolType} (unknown)</option>
              )}
            </Select>
            {unknownToolType && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Unknown tool type "{node.data.config.toolType}" — it is no longer in the registry. Pick a
                replacement, or leave it and this node will fail at run time.
              </p>
            )}
            {selectedTool?.description && <p className="text-xs text-slate-400">{selectedTool.description}</p>}
            <ToolConfigFields
              schema={selectedTool?.configSchema}
              values={node.data.config.toolConfig || {}}
              onChange={(toolConfig) => set({ toolConfig })}
            />
            <MockBehaviorFields
              overrides={node.data.config.mockOverrides || {}}
              defaults={toolDefaults}
              onChange={(mockOverrides) => set({ mockOverrides })}
            />
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

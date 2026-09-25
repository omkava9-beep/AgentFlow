import { nodeTypeMeta } from './ui/nodeTypes';

// spec/31's grouped palette. Integrations are the Tool node, whose picker
// lists every integration from spec/26.
export const NODE_GROUPS = [
  { title: 'Flow', types: ['start', 'end', 'condition', 'merge', 'delay', 'loop', 'subworkflow', 'approval'] },
  { title: 'Data', types: ['transform', 'code'] },
  { title: 'AI', types: ['agent'] },
  { title: 'Integrations', types: ['tool'] },
];

export const NODE_LABELS = { subworkflow: 'Sub-workflow', tool: 'Tool / integration' };
export const NODE_HINTS = {
  start: 'Where a run begins',
  end: 'Collects the output',
  condition: 'Branch on an expression',
  merge: 'Join branches',
  delay: 'Wait before continuing',
  loop: 'Run a workflow per item',
  subworkflow: 'Call another workflow',
  approval: 'Pause for a human decision',
  transform: 'Reshape data',
  code: 'Run JavaScript',
  agent: 'LLM reasoning + tools',
  tool: 'Slack, GitHub, HTTP, MCP…',
};

/** MIME type for dragging a node type from the rail or menu onto the canvas. */
export const NODE_DRAG_TYPE = 'application/x-agentflow-node';

export const nodeLabel = (type) => NODE_LABELS[type] || nodeTypeMeta(type).label;


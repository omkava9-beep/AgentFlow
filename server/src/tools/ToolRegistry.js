import { TOOL_HANDLERS } from './toolHandlers.js';

export const ToolRegistry = {
  list() {
    return Object.entries(TOOL_HANDLERS).map(([type, handler]) => ({ type, label: handler.label }));
  },
  get(toolType) {
    return TOOL_HANDLERS[toolType] || null;
  },
};

import { TOOL_HANDLERS } from './toolHandlers.js';

export const ToolRegistry = {
  /** Everything the Node Config Panel needs to render a tool's form generically. */
  list() {
    return Object.entries(TOOL_HANDLERS).map(([type, handler]) => ({
      type,
      label: handler.label,
      description: handler.description || '',
      configSchema: handler.configSchema || [],
    }));
  },
  get(toolType) {
    return TOOL_HANDLERS[toolType] || null;
  },
  types() {
    return Object.keys(TOOL_HANDLERS);
  },
};

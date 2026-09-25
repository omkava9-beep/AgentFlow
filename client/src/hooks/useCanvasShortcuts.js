import { useEffect } from 'react';
import { useWorkflowStore } from '../store/workflowStore';

/** True while the user is typing, so canvas shortcuts must stand down. */
function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** `enabled: false` for viewers (spec/23) - every shortcut here edits the graph. */
export function useCanvasShortcuts({ enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;
    function onKeyDown(event) {
      // Backspace in the workflow-name field must delete a character, not a node.
      if (isTyping(event.target)) return;

      const store = useWorkflowStore.getState();
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        store.redo();
        return;
      }
      if (mod && key === 'c') {
        store.copySelection();
        return;
      }
      if (mod && key === 'v') {
        event.preventDefault();
        store.paste();
        return;
      }
      if (mod && key === 'd') {
        event.preventDefault();
        store.duplicateSelection();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        store.deleteSelection();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

import { useEffect } from 'react';

/** Sets `document.title` to "<title> — AgentFlow" while mounted (spec/36 §6). */
export function useDocumentTitle(title) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} — AgentFlow`;
  }, [title]);
}

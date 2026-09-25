import { useCallback, useEffect, useState } from 'react';
import { getWorkflow } from '../api/workflows';
import { on } from '../realtime/socket';

/**
 * spec/30: the workflow's live version and whether the draft differs from it.
 * Loaded once, then kept current by `version:published` / `version:draft_state`
 * on the workflow room the Builder has already joined.
 */
export function useVersionState(workflowId) {
  const [state, setState] = useState({ publishedVersion: null, hasUnpublishedChanges: false, loaded: false });

  const refresh = useCallback(
    () =>
      getWorkflow(workflowId)
        .then((wf) => setState({
          publishedVersion: wf.publishedVersion ?? null,
          hasUnpublishedChanges: Boolean(wf.hasUnpublishedChanges),
          loaded: true,
        }))
        .catch(() => {}),
    [workflowId],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const mine = (p) => String(p?.workflowId) === String(workflowId);
    const offs = [
      on('version:draft_state', (p) => mine(p) && setState((s) => ({ ...s, hasUnpublishedChanges: Boolean(p.hasUnpublishedChanges) }))),
      on('version:published', (p) => mine(p) && setState((s) => ({ ...s, publishedVersion: p.version }))),
    ];
    return () => offs.forEach((off) => off());
  }, [workflowId]);

  return { ...state, refresh };
}

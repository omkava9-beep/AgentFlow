import { useEffect } from 'react';
import { listRuns } from '../../api/workflows';
import { getRun } from '../../api/runs';
import { useCanvasUi } from './canvasUiStore';
import { on } from '../../realtime/socket';

/**
 * Keeps `useCanvasUi().latestRun` pointed at this workflow's most recent
 * top-level run, with its node results - what the canvas's run overlay and the
 * inspector's Output tab read. Refetched live on run:status_changed and on
 * focus, so a run's result shows up without a reload. Best effort: a failure leaves the
 * overlay empty rather than breaking the Builder.
 */
export function useLatestRun(workflowId) {
  useEffect(() => {
    if (!workflowId) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const list = await listRuns(workflowId);
        const rows = Array.isArray(list) ? list : list?.runs || list?.items || [];
        const latest = rows.find((r) => !r.parentRunId) || rows[0];
        const id = latest?._id || latest?.id;
        if (!id) {
          if (!cancelled) useCanvasUi.getState().setLatestRun(null);
          return;
        }
        const run = await getRun(id);
        if (!cancelled) useCanvasUi.getState().setLatestRun(run);
      } catch {
        /* the overlay is a nicety; the canvas works without it */
      }
    }
    useCanvasUi.getState().setLatestRun(null);
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    // Live: any status change of one of this workflow's top-level runs (the
    // workspace room carries run:status_changed, spec/35) refreshes it, so the
    // overlay and the Output tab follow a run as it happens.
    let timer = null;
    const offStatus = on('run:status_changed', (p) => {
      if (String(p?.workflowId) !== String(workflowId) || p?.parentRunId) return;
      clearTimeout(timer);
      timer = setTimeout(load, 250);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      offStatus();
      window.removeEventListener('focus', onFocus);
    };
  }, [workflowId]);
}

/** The latest run's result for one node, or null. */
export function nodeResultOf(run, nodeId) {
  return run?.nodeResults?.find((r) => r.nodeId === nodeId) || null;
}

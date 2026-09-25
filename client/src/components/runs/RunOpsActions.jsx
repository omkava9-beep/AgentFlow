import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rerunRun, retryRun, getRetryPlan } from '../../api/runs';
import { apiErrorMessage } from '../../api/client';
import { useCan } from '../../hooks/useCan';
import { useWorkspacePath } from '../../hooks/useWorkspacePath';
import { Button } from '../ui';

const TERMINAL = ['success', 'failed', 'cancelled'];

/**
 * spec/35 §1-2: "Re-run" (same input, same executed graph) and "Retry from
 * failed" (re-execute the failed nodes and what depends on them, reuse the
 * rest). The retry popover previews exactly what will re-execute and what
 * will be reused - so an upstream send isn't a surprise.
 */
export default function RunOpsActions({ run, labelOf = (id) => id }) {
  const canRun = useCan('workflow:run');
  const wp = useWorkspacePath();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(null);
  const [selected, setSelected] = useState(null);
  const popover = useRef(null);

  const terminal = TERMINAL.includes(run.status);
  const isChild = Boolean(run.parentRunId);
  const hasGraph = Boolean(run.graph);
  const hasHandled = (run.nodeResults || []).some((r) => r.handled);
  const canRetry = terminal && !isChild && hasGraph && (run.status !== 'success' || hasHandled);

  // The candidate list: every node that failed (handled ones too - retrying
  // them is opt-in), plus whatever the server's default plan picked.
  const candidates = [...new Set([
    ...(plan?.defaultSet || []),
    ...(run.nodeResults || []).filter((r) => r.status === 'failed').map((r) => r.nodeId),
  ])];

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (popover.current && !popover.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function openRetry() {
    setError('');
    setOpen(true);
    try {
      const p = await getRetryPlan(run._id);
      setPlan({ ...p, defaultSet: p.retrySet || [] });
      setSelected(p.retrySet || []);
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't plan the retry"));
    }
  }

  async function toggle(nodeId) {
    const next = selected.includes(nodeId) ? selected.filter((id) => id !== nodeId) : [...selected, nodeId];
    setSelected(next);
    if (!next.length) return setPlan((p) => ({ ...p, reexecuted: [], reused: [] }));
    try {
      const p = await getRetryPlan(run._id, next);
      setPlan((prev) => ({ ...p, defaultSet: prev?.defaultSet || [] }));
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't plan the retry"));
    }
  }

  async function doRerun() {
    setBusy('rerun');
    setError('');
    try {
      const { runId } = await rerunRun(run._id);
      navigate(wp(`/runs/${runId}`));
    } catch (err) {
      setError(apiErrorMessage(err, 'Re-run failed'));
    } finally {
      setBusy(null);
    }
  }

  async function doRetry() {
    setBusy('retry');
    setError('');
    try {
      const same = JSON.stringify([...selected].sort()) === JSON.stringify([...(plan?.defaultSet || [])].sort());
      const { runId } = await retryRun(run._id, same ? null : selected);
      setOpen(false);
      navigate(wp(`/runs/${runId}`));
    } catch (err) {
      setError(apiErrorMessage(err, 'Retry failed'));
    } finally {
      setBusy(null);
    }
  }

  if (!canRun || !terminal || isChild) return null;

  return (
    <div className="relative flex items-center gap-2">
      <Button
        variant="secondary"
        className="!px-3 !py-1 text-xs"
        onClick={doRerun}
        disabled={Boolean(busy) || !hasGraph}
        title={hasGraph ? 'Run again with the same input on the same graph' : 'This run predates versioning, so its graph is unknown'}
      >
        {busy === 'rerun' ? 'Starting…' : '↻ Re-run'}
      </Button>
      {canRetry && (
        <Button variant="secondary" className="!px-3 !py-1 text-xs" onClick={openRetry} disabled={Boolean(busy)}>
          ⟲ Retry from failed
        </Button>
      )}
      {error && <span className="text-xs text-red-500">{error}</span>}

      {open && (
        <div ref={popover} className="absolute left-0 top-9 z-30 w-80 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <p className="mb-2 font-semibold text-slate-700 dark:text-slate-200">Retry from</p>
          {!plan ? (
            <p className="text-slate-400">Planning…</p>
          ) : !plan.retryable && !candidates.length ? (
            <p className="text-slate-500">{plan.reason}</p>
          ) : (
            <>
              <div className="mb-2 space-y-1">
                {candidates.map((id) => (
                  <label key={id} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={selected?.includes(id)} onChange={() => toggle(id)} />
                    {labelOf(id)}
                    {(run.nodeResults || []).find((r) => r.nodeId === id)?.handled && <span className="text-[10px] text-amber-600">handled</span>}
                  </label>
                ))}
              </div>
              <p className="text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-700 dark:text-slate-200">Re-executes:</span>{' '}
                {plan.reexecuted?.length ? plan.reexecuted.map(labelOf).join(', ') : '—'}
              </p>
              <p className="mt-1 text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-700 dark:text-slate-200">Reused (not run again):</span>{' '}
                {plan.reused?.length ? plan.reused.map(labelOf).join(', ') : '—'}
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
                <Button className="!px-2 !py-1 text-xs" onClick={doRetry} disabled={!selected?.length || Boolean(busy)}>
                  {busy === 'retry' ? 'Starting…' : 'Retry'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

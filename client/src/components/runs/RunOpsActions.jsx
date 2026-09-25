import { useState } from 'react';
import { Repeat2, RotateCcw } from 'lucide-react';
import { Checkbox } from '../ui/Form';
import { useNavigate } from 'react-router-dom';
import { rerunRun, retryRun, getRetryPlan } from '../../api/runs';
import { apiErrorMessage } from '../../api/client';
import { useCan } from '../../hooks/useCan';
import { useWorkspacePath } from '../../hooks/useWorkspacePath';
import { Button, Badge, Tooltip, Popover, PopoverTrigger, PopoverContent } from '../ui';

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
    <div className="flex items-center gap-2">
      <Tooltip content={hasGraph ? 'Run again with the same input on the same graph' : 'This run predates versioning, so its graph is unknown'}>
        <span className="inline-flex">
          <Button size="sm" variant="secondary" icon={Repeat2} onClick={doRerun} loading={busy === 'rerun'} disabled={Boolean(busy) || !hasGraph}>
            Re-run
          </Button>
        </span>
      </Tooltip>
      {canRetry && (
        <Popover open={open} onOpenChange={(v) => (v ? openRetry() : setOpen(false))}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="secondary" icon={RotateCcw} disabled={Boolean(busy)}>Retry from failed</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 text-xs">
            <p className="mb-1 text-sm font-semibold text-fg">Retry from</p>
            <p className="mb-3 text-subtle">Failed nodes and everything downstream re-execute; the rest is reused as-is.</p>
            {!plan ? (
              <p className="text-subtle">Planning…</p>
            ) : !plan.retryable && !candidates.length ? (
              <p className="text-muted">{plan.reason}</p>
            ) : (
              <>
                <div className="mb-3 space-y-1.5">
                  {candidates.map((id) => (
                    <div key={id} className="flex items-center gap-2">
                      <Checkbox size="sm" checked={selected?.includes(id)} onCheckedChange={() => toggle(id)} label={labelOf(id)} />
                      {(run.nodeResults || []).find((r) => r.nodeId === id)?.handled && <Badge tone="warning" size="xs">Handled</Badge>}
                    </div>
                  ))}
                </div>
                <div className="space-y-1 rounded-control border border-default bg-bg-subtle p-2">
                  <p className="text-muted">
                    <span className="font-medium text-fg">Re-executes:</span>{' '}
                    {plan.reexecuted?.length ? plan.reexecuted.map(labelOf).join(', ') : '—'}
                  </p>
                  <p className="text-muted">
                    <span className="font-medium text-fg">Reused (not run again):</span>{' '}
                    {plan.reused?.length ? plan.reused.map(labelOf).join(', ') : '—'}
                  </p>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button size="sm" onClick={doRetry} loading={busy === 'retry'} disabled={!selected?.length || Boolean(busy)}>Retry</Button>
                </div>
              </>
            )}
            {error && <p className="mt-2 text-danger">{error}</p>}
          </PopoverContent>
        </Popover>
      )}
      {error && !open && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

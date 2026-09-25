import { Link } from 'react-router-dom';

const short = (id) => `#${String(id).slice(-6)}`;

/**
 * spec/35: where a run came from - "Re-run of #…", "Retry of #… from Fetch
 * invoices" - and, when the version it ran is no longer current, which one.
 * `linkTo(runId)` builds the monitor URL (workspace or shared view).
 */
export default function RunLineage({ run, labelOf = (id) => id, linkTo, currentVersion }) {
  const chip = 'rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 hover:underline dark:bg-slate-800 dark:text-slate-300';
  const target = (id) => (linkTo ? linkTo(id) : null);
  return (
    <>
      {run.rerunOf && (
        target(run.rerunOf)
          ? <Link to={target(run.rerunOf)} className={chip}>↻ Re-run of {short(run.rerunOf)}</Link>
          : <span className={chip}>↻ Re-run of {short(run.rerunOf)}</span>
      )}
      {run.retryOf && (
        <Link to={target(run.retryOf) || '#'} className={chip}>
          ⟲ Retry of {short(run.retryOf)}
          {run.retriedFromNodeIds?.length ? ` from ${run.retriedFromNodeIds.map(labelOf).join(', ')}` : ''}
        </Link>
      )}
      {!run.isDraft && run.versionNumber && currentVersion && currentVersion !== run.versionNumber && (
        <span className="text-[10px] text-slate-400" title="Re-runs and retries use the version this run executed">
          on v{run.versionNumber} (current is v{currentVersion})
        </span>
      )}
    </>
  );
}

import { Link } from 'react-router-dom';
import { Repeat2, RotateCcw, History } from 'lucide-react';
import { Badge, Tooltip } from '../ui';

const short = (id) => `#${String(id).slice(-6)}`;

/**
 * spec/35: where a run came from - "Re-run of #…", "Retry of #… from Fetch
 * invoices" - and, when the version it ran is no longer current, which one.
 * `linkTo(runId)` builds the monitor URL (workspace or shared view).
 */
export default function RunLineage({ run, labelOf = (id) => id, linkTo, currentVersion }) {
  const target = (id) => (linkTo ? linkTo(id) : null);
  const chip = (to, icon, text) => (to
    ? <Link to={to} className="inline-flex hover:opacity-80"><Badge icon={icon} size="xs">{text}</Badge></Link>
    : <Badge icon={icon} size="xs">{text}</Badge>);
  return (
    <>
      {run.rerunOf && chip(target(run.rerunOf), Repeat2, `Re-run of ${short(run.rerunOf)}`)}
      {run.retryOf && chip(
        target(run.retryOf),
        RotateCcw,
        `Retry of ${short(run.retryOf)}${run.retriedFromNodeIds?.length ? ` from ${run.retriedFromNodeIds.map(labelOf).join(', ')}` : ''}`,
      )}
      {!run.isDraft && run.versionNumber && currentVersion && currentVersion !== run.versionNumber && (
        <Tooltip content="Re-runs and retries use the version this run executed">
          <span className="inline-flex"><Badge tone="warning" icon={History} size="xs">On v{run.versionNumber} · current is v{currentVersion}</Badge></span>
        </Tooltip>
      )}
    </>
  );
}

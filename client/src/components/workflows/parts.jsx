import { Link } from 'react-router-dom';
import { Badge, IntegrationLogo, StatusBadge, Tooltip, cx } from '../ui/index';
import { formatRelativeTime } from '../../utils/time';
import { TRIGGER_META, displayIntegrations, successRate, triggerTypes, versionState } from './workflowMeta';

/** Published v3 / Unpublished changes / Draft - the version state as one badge. */
export function VersionBadge({ workflow }) {
  const state = versionState(workflow);
  if (state === 'draft') {
    return (
      <Tooltip content="Never published — schedules, webhooks and events skip it">
        <span><Badge tone="neutral" size="xs">Draft</Badge></span>
      </Tooltip>
    );
  }
  if (state === 'changes') {
    return (
      <Tooltip content={`Live: v${workflow.publishedVersion} · the draft has changes that aren't published`}>
        <span><Badge tone="warning" size="xs" dot>v{workflow.publishedVersion} · changes</Badge></span>
      </Tooltip>
    );
  }
  return <Badge tone="success" size="xs" dot>Published v{workflow.publishedVersion}</Badge>;
}

/** Overlapping integration marks with a +N chip. `names` maps id → display name. */
export function IntegrationStack({ workflow, names, max = 4, size = 'sm' }) {
  const ids = displayIntegrations(workflow);
  if (!ids.length) return <span className="text-xs text-subtle">—</span>;
  const shown = ids.slice(0, max);
  const extra = ids.length - shown.length;
  return (
    <div className="flex items-center gap-1">
      {shown.map((id) => (
        <Tooltip key={id} content={names?.get(id) || labelFor(id)}>
          <span className="inline-flex"><IntegrationLogo id={id} size={size} /></span>
        </Tooltip>
      ))}
      {extra > 0 && (
        <Tooltip content={ids.slice(max).map((id) => names?.get(id) || labelFor(id)).join(', ')}>
          <span className="ml-0.5 text-2xs font-medium tabular-nums text-subtle">+{extra}</span>
        </Tooltip>
      )}
    </div>
  );
}

function labelFor(id) {
  if (id === 'ai') return 'AI agent';
  if (id === 'builtin') return 'Built-in demo tools';
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Small icons for every active trigger; manual when none. */
export function TriggerIcons({ workflow, className = '' }) {
  return (
    <span className={cx('flex items-center gap-1 text-subtle', className)}>
      {triggerTypes(workflow).map((type) => {
        const meta = TRIGGER_META[type] || TRIGGER_META.manual;
        const Icon = meta.icon;
        return (
          <Tooltip key={type} content={meta.label}>
            <span className="inline-flex"><Icon className="h-3.5 w-3.5" aria-label={meta.label} /></span>
          </Tooltip>
        );
      })}
    </span>
  );
}

/** Last run as a status badge + relative time, linking to the run monitor. */
export function LastRun({ workflow, wp, compact = false }) {
  const run = workflow.lastRun;
  if (!run) return <span className="text-xs text-subtle">No runs yet</span>;
  return (
    <Link
      to={wp(`/runs/${run.id}`)}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-2 rounded-control hover:opacity-80"
    >
      <StatusBadge status={run.status} size="xs" />
      {!compact && <span className="text-xs tabular-nums text-subtle">{formatRelativeTime(run.startedAt)}</span>}
    </Link>
  );
}

/**
 * Eight daily bars (the last 7 days + today) scaled to the busiest day. Empty
 * days show as a hairline so the week's shape still reads.
 */
export function Sparkline({ daily = [], className = '', height = 20 }) {
  const max = Math.max(1, ...daily);
  const barW = 5; const gap = 2;
  const width = daily.length * (barW + gap) - gap;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true">
      {daily.map((count, i) => {
        const h = count ? Math.max(3, Math.round((count / max) * height)) : 1;
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={height - h}
            width={barW}
            height={h}
            rx={1}
            className={count ? (i === daily.length - 1 ? 'fill-accent' : 'fill-accent/45') : 'fill-fg-subtle '}
          />
        );
      })}
    </svg>
  );
}

/** Sparkline + "12 runs · 92%" for a workflow's last 7 days. */
export function Activity({ workflow }) {
  const stats = workflow.stats7d || { total: 0, daily: [] };
  const rate = successRate(stats);
  return (
    <Tooltip content={stats.total ? `${stats.total} runs in 7 days · ${stats.success} succeeded · ${stats.failed} failed` : 'No runs in the last 7 days'}>
      <span className="inline-flex items-center gap-2">
        <Sparkline daily={stats.daily} />
        <span className="w-9 text-right text-xs tabular-nums">
          {rate == null ? <span className="text-subtle">—</span> : (
            <span className={rate >= 90 ? 'text-success' : rate >= 70 ? 'text-warning' : 'text-danger'}>{rate}%</span>
          )}
        </span>
      </span>
    </Tooltip>
  );
}

import { useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, ChevronDown, ChevronRight } from 'lucide-react';
import { cx } from './ui/cx';

const TONE = {
  error: { icon: XCircle, iconClass: 'text-danger', pill: 'border-danger/30 bg-danger-subtle text-danger-subtle-fg' },
  warning: { icon: AlertTriangle, iconClass: 'text-warning', pill: 'border-warning/30 bg-warning-subtle text-warning-subtle-fg' },
  // Advisory only (spec/26: "runs in sandbox until a connection is selected") —
  // it never blocks saving or running.
  info: { icon: Info, iconClass: 'text-info', pill: 'border-default bg-surface text-muted' },
};

// Bottom-left of the canvas; the zoom controls live top-left, so they never overlap.
const DOCK = 'absolute bottom-4 left-4 z-10';

export default function ValidationPanel({ errors, warnings, info = [], onSelectNode }) {
  const [open, setOpen] = useState(false);
  const total = errors.length + warnings.length;

  if (!total && !info.length) {
    return (
      <div className={cx(DOCK, 'pointer-events-none flex h-7 items-center gap-1.5 rounded-full border border-default bg-surface px-2.5 text-xs font-medium text-muted shadow-sm')}>
        <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
        Ready to run
      </div>
    );
  }

  const summary = [
    errors.length && `${errors.length} error${errors.length > 1 ? 's' : ''}`,
    warnings.length && `${warnings.length} warning${warnings.length > 1 ? 's' : ''}`,
    info.length && `${info.length} note${info.length > 1 ? 's' : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const kind = errors.length ? 'error' : warnings.length ? 'warning' : 'info';
  const tone = TONE[kind];
  const SummaryIcon = total ? tone.icon : CheckCircle2;
  const Chevron = open ? ChevronDown : ChevronRight;
  const entries = [
    ...errors.map((e) => ({ ...e, kind: 'error' })),
    ...warnings.map((w) => ({ ...w, kind: 'warning' })),
    ...info.map((i) => ({ ...i, kind: 'info' })),
  ];

  return (
    <div className={cx(DOCK, 'max-w-md')}>
      {open && (
        <ul className="mb-2 max-h-64 space-y-0.5 overflow-y-auto rounded-card border border-default bg-surface-raised p-1.5 shadow-popover">
          {entries.map((entry) => {
            const entryTone = TONE[entry.kind];
            const Icon = entryTone.icon;
            const clickable = Boolean(entry.nodeId);
            return (
              <li key={entry.id}>
                <button
                  disabled={!clickable}
                  onClick={() => onSelectNode(entry.nodeId)}
                  className={cx('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg', clickable ? 'hover:bg-bg-subtle' : 'cursor-default')}
                >
                  <Icon className={cx('mt-px h-3.5 w-3.5 shrink-0', entryTone.iconClass)} aria-hidden="true" />
                  <span>{entry.message}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cx('flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium shadow-sm', total ? tone.pill : TONE.info.pill)}
      >
        <SummaryIcon className={cx('h-3.5 w-3.5', total ? tone.iconClass : 'text-success')} aria-hidden="true" />
        {total ? summary : `Ready to run · ${summary}`}
        <Chevron className="h-3 w-3 opacity-60" aria-hidden="true" />
      </button>
    </div>
  );
}

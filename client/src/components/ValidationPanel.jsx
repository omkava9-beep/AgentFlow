import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, ChevronUp, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';
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

/**
 * The canvas's validation status: a pill, and on click a compact popover
 * anchored above it (never a panel spread over the graph). It opens by itself
 * only when an ERROR appears - warnings and notes stay a pill until asked for.
 */
export default function ValidationPanel({ errors, warnings, info = [], onSelectNode }) {
  const [open, setOpen] = useState(errors.length > 0);
  const hadErrors = useRef(errors.length > 0);
  useEffect(() => {
    const has = errors.length > 0;
    if (has && !hadErrors.current) setOpen(true);
    hadErrors.current = has;
  }, [errors.length]);

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
  const entries = [
    ...errors.map((e) => ({ ...e, kind: 'error' })),
    ...warnings.map((w) => ({ ...w, kind: 'warning' })),
    ...info.map((i) => ({ ...i, kind: 'info' })),
  ];

  return (
    <div className={DOCK}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cx('flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium shadow-sm', total ? tone.pill : TONE.info.pill)}
          >
            <SummaryIcon className={cx('h-3.5 w-3.5', total ? tone.iconClass : 'text-success')} aria-hidden="true" />
            {total ? summary : `Ready to run · ${summary}`}
            <ChevronUp className={cx('h-3 w-3 opacity-60 transition-transform', !open && 'rotate-180')} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          padded={false}
          // Don't steal focus from the canvas when it opens on its own.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden"
        >
          <div data-testid="validation-list">
            <div className="flex items-center justify-between border-b border-default px-3 py-1.5">
              <span className="text-xs font-semibold text-fg">{errors.length ? 'Fix before running' : total ? 'Check before running' : 'Notes'}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-0.5 text-subtle hover:bg-bg-subtle hover:text-fg">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <ul className="max-h-60 space-y-0.5 overflow-y-auto p-1.5">
              {entries.map((entry) => {
                const entryTone = TONE[entry.kind];
                const Icon = entryTone.icon;
                const clickable = Boolean(entry.nodeId);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
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
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

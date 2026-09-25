import { useState } from 'react';

const TONE = {
  error: {
    dot: 'bg-red-500',
    text: 'text-red-700 dark:text-red-300',
    pill: 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300',
  },
  warning: {
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
    pill: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  },
  // Advisory only (spec/26: "runs in sandbox until a connection is selected") —
  // it never blocks saving or running.
  info: {
    dot: 'bg-sky-500',
    text: 'text-sky-700 dark:text-sky-300',
    pill: 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  },
};

export default function ValidationPanel({ errors, warnings, info = [], onSelectNode }) {
  const [open, setOpen] = useState(false);
  const total = errors.length + warnings.length;

  if (!total && !info.length) {
    return (
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-full border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 shadow-sm dark:border-green-800 dark:bg-green-950/60 dark:text-green-300">
        ✓ Ready to run
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

  const tone = errors.length ? TONE.error : warnings.length ? TONE.warning : TONE.info;
  const entries = [
    ...errors.map((e) => ({ ...e, kind: 'error' })),
    ...warnings.map((w) => ({ ...w, kind: 'warning' })),
    ...info.map((i) => ({ ...i, kind: 'info' })),
  ];

  return (
    <div className="absolute bottom-4 left-4 z-10 max-w-md">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm ${tone.pill}`}
      >
        {open ? '▾' : '▸'} {total ? summary : `✓ Ready to run · ${summary}`}
      </button>

      {open && (
        <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95">
          {entries.map((entry) => {
            const entryTone = TONE[entry.kind];
            const clickable = Boolean(entry.nodeId);
            return (
              <li key={entry.id}>
                <button
                  disabled={!clickable}
                  onClick={() => onSelectNode(entry.nodeId)}
                  className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs ${
                    clickable ? 'hover:bg-slate-100 dark:hover:bg-slate-800' : 'cursor-default'
                  }`}
                >
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${entryTone.dot}`} />
                  <span className={entryTone.text}>{entry.message}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

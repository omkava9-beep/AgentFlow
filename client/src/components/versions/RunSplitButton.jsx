import { useEffect, useRef, useState } from 'react';

/**
 * spec/30: "▶ Test run (draft)" is the default; "Run published vN" sits in the
 * dropdown. The test run follows the Builder's blocking rules; running the
 * published version only needs one to exist (and the daily quota).
 */
export default function RunSplitButton({ onRun, running, testBlocked, testBlockedReason, quotaBlocked, quotaReason, publishedVersion }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const base = 'border border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';
  const testDisabled = running || testBlocked || quotaBlocked;
  const publishedDisabled = running || quotaBlocked || !publishedVersion;

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        className={`${base} rounded-l-lg px-4 py-2`}
        onClick={() => onRun('draft')}
        disabled={testDisabled}
        title={quotaBlocked ? quotaReason : testBlockedReason || 'Run the current draft as a test'}
      >
        {running ? 'Starting…' : '▶ Test run'}
      </button>
      <button
        type="button"
        aria-label="More run options"
        className={`${base} rounded-r-lg border-l-0 px-2 py-2`}
        onClick={() => setOpen((o) => !o)}
        disabled={running}
      >
        ▾
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            className="w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-800"
            onClick={() => { setOpen(false); onRun('draft'); }}
            disabled={testDisabled}
          >
            ▶ Test run (draft)
          </button>
          <button
            type="button"
            className="w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-800"
            onClick={() => { setOpen(false); onRun('published'); }}
            disabled={publishedDisabled}
            title={!publishedVersion ? 'Publish a version first' : quotaBlocked ? quotaReason : undefined}
          >
            {publishedVersion ? `Run published v${publishedVersion}` : 'Run published (none yet)'}
          </button>
        </div>
      )}
    </div>
  );
}

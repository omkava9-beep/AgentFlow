import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Play, Rocket } from 'lucide-react';

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

  const base = 'inline-flex h-8 items-center gap-1.5 border border-default bg-surface text-sm font-medium text-fg shadow-sm transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-50';
  const testDisabled = running || testBlocked || quotaBlocked;
  const publishedDisabled = running || quotaBlocked || !publishedVersion;

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        className={`${base} rounded-l-control px-3`}
        onClick={() => onRun('draft')}
        disabled={testDisabled}
        title={quotaBlocked ? quotaReason : testBlockedReason || 'Run the current draft as a test'}
      >
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="h-3.5 w-3.5 text-success" aria-hidden="true" />}
        {running ? 'Starting…' : 'Test run'}
      </button>
      <button
        type="button"
        aria-label="More run options"
        className={`${base} rounded-r-control border-l-0 px-1.5`}
        onClick={() => setOpen((o) => !o)}
        disabled={running}
      >
        <ChevronDown className="h-3.5 w-3.5 text-subtle" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-60 animate-pop-in rounded-card border border-default bg-surface-raised p-1 shadow-popover">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => { setOpen(false); onRun('draft'); }}
            disabled={testDisabled}
          >
            <Play className="h-4 w-4 text-subtle" aria-hidden="true" /> Test run (draft)
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => { setOpen(false); onRun('published'); }}
            disabled={publishedDisabled}
            title={!publishedVersion ? 'Publish a version first' : quotaBlocked ? quotaReason : undefined}
          >
            <Rocket className="h-4 w-4 text-subtle" aria-hidden="true" />
            {publishedVersion ? `Run published v${publishedVersion}` : 'Run published (none yet)'}
          </button>
        </div>
      )}
    </div>
  );
}

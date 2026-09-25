/**
 * Retry and failure-injection controls for a Tool node (spec/17, spec/26). Both
 * fields are *overrides*: unset means "use the server default", which is shown
 * inline so an empty control never reads as "0".
 *
 * Failure injection applies to sandbox calls only — a live call has real
 * failures of its own — so the slider is hidden for a node predicted to run
 * live. Max attempts applies in both modes.
 */
export default function MockBehaviorFields({ overrides = {}, defaults, onChange, mode = 'sandbox' }) {
  const hasFailureOverride = overrides.failureRate !== undefined && overrides.failureRate !== null;
  const failurePercent = Math.round((hasFailureOverride ? overrides.failureRate : defaults?.failureRate ?? 0) * 100);
  const defaultPercent = Math.round((defaults?.failureRate ?? 0) * 100);

  const hasAttemptsOverride = overrides.maxAttempts !== undefined && overrides.maxAttempts !== null;

  function patch(next) {
    onChange({ ...overrides, ...next });
  }

  function clear(key) {
    const next = { ...overrides };
    delete next[key];
    onChange(next);
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Retries &amp; failure injection</p>

      {mode === 'live' ? (
        <p className="text-xs text-slate-400">
          Failure injection applies to sandbox calls only — this node calls the real service, which fails on its own.
          {hasFailureOverride && ' The stored override is kept and applies if it runs in the sandbox.'}
        </p>
      ) : (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor="failure-rate" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Simulated failure rate
            </label>
            <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {failurePercent}%
              {!hasFailureOverride && <span className="text-slate-400"> (server default)</span>}
            </span>
          </div>
          <input
            id="failure-rate"
            type="range"
            min="0"
            max="100"
            step="5"
            value={failurePercent}
            onChange={(e) => patch({ failureRate: Number(e.target.value) / 100 })}
            className="w-full accent-brand-500"
          />
          <div className="mt-1 flex items-center justify-between">
            <p className="text-xs text-slate-400">
              {failurePercent === 100
                ? 'Always fails — exhausts retries, then fails the run.'
                : failurePercent === 0
                  ? 'Never fails.'
                  : `~${failurePercent}% of sandbox calls simulate a failure and retry.`}
            </p>
            {hasFailureOverride && (
              <button
                type="button"
                onClick={() => clear('failureRate')}
                className="shrink-0 text-xs text-brand-600 hover:underline dark:text-brand-400"
              >
                Use default ({defaultPercent}%)
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Sandbox calls only — never applied to live calls.</p>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label htmlFor="max-attempts" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Max attempts
          </label>
          {hasAttemptsOverride && (
            <button
              type="button"
              onClick={() => clear('maxAttempts')}
              className="text-xs text-brand-600 hover:underline dark:text-brand-400"
            >
              Use default ({defaults?.maxAttempts ?? 3})
            </button>
          )}
        </div>
        <input
          id="max-attempts"
          type="number"
          min="1"
          max="10"
          value={hasAttemptsOverride ? overrides.maxAttempts : ''}
          placeholder={`server default (${defaults?.maxAttempts ?? 3})`}
          onChange={(e) =>
            e.target.value === '' ? clear('maxAttempts') : patch({ maxAttempts: Number(e.target.value) })
          }
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <p className="mt-1 text-xs text-slate-400">Applies to live and sandbox calls. Retries back off exponentially.</p>
      </div>
    </div>
  );
}

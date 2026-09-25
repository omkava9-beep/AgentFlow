import { NumberInput, Slider } from './ui/Form';

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
    <div className="space-y-4 rounded-card border border-default p-3">
      <p className="text-2xs font-medium uppercase tracking-wider text-subtle">Retries &amp; failure injection</p>

      {mode === 'live' ? (
        <p className="text-xs text-subtle">
          Failure injection applies to sandbox calls only — this node calls the real service, which fails on its own.
          {hasFailureOverride && ' The stored override is kept and applies if it runs in the sandbox.'}
        </p>
      ) : (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span id="failure-rate-label" className="text-sm font-medium text-fg">Simulated failure rate</span>
            <span className="text-xs tabular-nums text-muted">
              {failurePercent}%
              {!hasFailureOverride && <span className="text-subtle"> (server default)</span>}
            </span>
          </div>
          <Slider
            aria-label="Simulated failure rate"
            min={0}
            max={100}
            step={5}
            value={failurePercent}
            onChange={(v) => patch({ failureRate: v / 100 })}
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="text-xs text-subtle">
              {failurePercent === 100
                ? 'Always fails — exhausts retries, then fails the run.'
                : failurePercent === 0
                  ? 'Never fails.'
                  : `~${failurePercent}% of sandbox calls simulate a failure and retry.`}
            </p>
            {hasFailureOverride && (
              <button type="button" onClick={() => clear('failureRate')} className="shrink-0 text-xs font-medium text-accent hover:underline">
                Use default ({defaultPercent}%)
              </button>
            )}
          </div>
          <p className="mt-1 text-2xs text-subtle">Sandbox calls only — never applied to live calls.</p>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor="max-attempts" className="text-sm font-medium text-fg">Max attempts</label>
          {hasAttemptsOverride && (
            <button type="button" onClick={() => clear('maxAttempts')} className="text-xs font-medium text-accent hover:underline">
              Use default ({defaults?.maxAttempts ?? 3})
            </button>
          )}
        </div>
        <NumberInput
          id="max-attempts"
          min={1}
          max={10}
          value={hasAttemptsOverride ? overrides.maxAttempts : ''}
          placeholder={`default (${defaults?.maxAttempts ?? 3})`}
          onValueChange={(v) => (v === '' ? clear('maxAttempts') : patch({ maxAttempts: v }))}
        />
        <p className="mt-1 text-xs text-subtle">Applies to live and sandbox calls. Retries back off exponentially.</p>
      </div>
    </div>
  );
}

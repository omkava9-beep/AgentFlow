import { Lock } from 'lucide-react';
import { useCan } from '../../hooks/useCan';

/**
 * spec/31 §2. Only `code:author` roles (owner, admin) may change the source;
 * everyone else sees it read-only. The server enforces the same rule.
 */
export default function CodePanel({ config, set }) {
  const canAuthor = useCan('code:author');
  const source = config.source || '';
  const lines = Math.max(source.split('\n').length, 8);

  return (
    <>
      <div className="rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger-subtle-fg">
        Runs with server privileges. Only for trusted code.
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-fg">Source</span>
        <div className="flex overflow-hidden rounded-lg border border-default">
          <pre aria-hidden className="select-none bg-bg-subtle px-2 py-2 text-right font-mono text-xs leading-5 text-subtle">
            {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
          </pre>
          <textarea
            value={source}
            onChange={(e) => set({ source: e.target.value })}
            readOnly={!canAuthor}
            spellCheck={false}
            rows={lines}
            className="w-full resize-y bg-surface px-2 py-2 font-mono text-xs leading-5 text-fg focus:outline-none"
          />
        </div>
      </label>
      {!canAuthor && (
        <p className="text-xs text-muted">
          <Lock className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />Read-only — editing code needs the <code>code:author</code> permission (owner or admin). You can still run it.
        </p>
      )}
      <p className="text-xs text-subtle">
        A function body: <code>input</code> is the upstream output; <code>return</code> the new value. <code>console.log</code> goes
        to the run log. No <code>require</code>, network or timers.
      </p>
    </>
  );
}

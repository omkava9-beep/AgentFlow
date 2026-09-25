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
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
        Runs with server privileges. Only for trusted code.
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Source</span>
        <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
          <pre aria-hidden className="select-none bg-slate-100 px-2 py-2 text-right font-mono text-xs leading-5 text-slate-400 dark:bg-slate-800/70">
            {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
          </pre>
          <textarea
            value={source}
            onChange={(e) => set({ source: e.target.value })}
            readOnly={!canAuthor}
            spellCheck={false}
            rows={lines}
            className="w-full resize-y bg-white px-2 py-2 font-mono text-xs leading-5 text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
      </label>
      {!canAuthor && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          🔒 Read-only — editing code needs the <code>code:author</code> permission (owner or admin). You can still run it.
        </p>
      )}
      <p className="text-xs text-slate-400">
        A function body: <code>input</code> is the upstream output; <code>return</code> the new value. <code>console.log</code> goes
        to the run log. No <code>require</code>, network or timers.
      </p>
    </>
  );
}

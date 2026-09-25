import { useState } from 'react';

const STATUS = {
  started: { icon: '…', tone: 'text-slate-400' },
  success: { icon: '✓', tone: 'text-emerald-600 dark:text-emerald-400' },
  failed: { icon: '✗', tone: 'text-red-500' },
};

function argsPreview(args) {
  if (args === undefined || args === null) return '';
  const text = typeof args === 'string' ? args : JSON.stringify(args);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * The nested timeline under an agent node (spec/37 §6):
 * `step 1 → lookup_customer({ id: 42 }) ✓ 180 ms (cached)` … `final answer`.
 * Rows expand to the full (already redacted) args and output.
 */
export default function ToolCallTimeline({ calls = [], agentSteps, finished }) {
  const [openId, setOpenId] = useState(null);
  if (!calls.length) return null;

  return (
    <ol data-testid="tool-call-timeline" className="mt-2 space-y-1 border-l-2 border-brand-200 pl-2 dark:border-brand-900">
      {calls.map((c) => {
        const s = STATUS[c.status] || STATUS.started;
        const id = c.callId || `${c.step}:${c.tool?.action}`;
        // `tool.name` is the sanitized name the model saw (`<connection>__<tool>`);
        // the monitor shows the tool's own name, as spec/37 §6's example does.
        const name = c.tool?.action || c.tool?.name || 'tool';
        const open = openId === id;
        return (
          <li key={id} className="text-[11px]">
            <button type="button" onClick={() => setOpenId(open ? null : id)} className="flex w-full items-center gap-1.5 text-left">
              <span className="text-slate-400">step {c.step}</span>
              <span className="text-slate-400">→</span>
              <code className="truncate font-semibold text-slate-700 dark:text-slate-200">
                {name}({argsPreview(c.args)})
              </code>
              <span className={`ml-auto shrink-0 ${s.tone}`}>{s.icon}</span>
              {typeof c.durationMs === 'number' && <span className="shrink-0 text-slate-400">{c.durationMs} ms</span>}
              {c.cached && (
                <span className="shrink-0 rounded bg-blue-100 px-1 text-[10px] text-blue-700 dark:bg-blue-950 dark:text-blue-300">cached</span>
              )}
              {c.sandbox && (
                <span className="shrink-0 rounded bg-slate-200 px-1 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">sandbox</span>
              )}
            </button>
            {c.status === 'failed' && c.error && <p className="ml-12 text-red-500">{c.error}</p>}
            {open && (
              <div className="ml-4 mt-1 space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Arguments</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-1.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {JSON.stringify(c.args ?? {}, null, 2)}
                </pre>
                {c.output !== undefined && (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Output</p>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-1.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {typeof c.output === 'string' ? c.output : JSON.stringify(c.output, null, 2)}
                    </pre>
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
      {finished && (
        <li className="text-[11px] text-slate-400">
          step {Math.max(agentSteps || 0, ...calls.map((c) => (c.step || 0) + 1))} → final answer
        </li>
      )}
    </ol>
  );
}

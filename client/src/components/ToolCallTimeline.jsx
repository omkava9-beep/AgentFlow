import { useState } from 'react';
import { ChevronRight, Loader2, CheckCircle2, XCircle, Flag } from 'lucide-react';
import { Badge, CopyButton, cx } from './ui';

const STATUS = {
  started: { icon: Loader2, tone: 'text-info', spin: true, label: 'running' },
  success: { icon: CheckCircle2, tone: 'text-success', label: 'succeeded' },
  failed: { icon: XCircle, tone: 'text-danger', label: 'failed' },
};

function argsPreview(args) {
  if (args === undefined || args === null) return '';
  const text = typeof args === 'string' ? args : JSON.stringify(args);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function JsonBlock({ label, value }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-2xs font-medium uppercase tracking-wide text-subtle">{label}</p>
        <CopyButton value={text} />
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-control border border-default bg-surface-sunken p-2 font-mono text-2xs text-muted">{text}</pre>
    </div>
  );
}

/**
 * The nested timeline under an agent node (spec/37 §6):
 * `step 1 → lookup_customer({ id: 42 })  ✓ 180 ms (cached)` … `final answer`.
 * Rows expand to the full (already redacted) args and output.
 */
export default function ToolCallTimeline({ calls = [], agentSteps, finished }) {
  const [openId, setOpenId] = useState(null);
  if (!calls.length) return null;

  return (
    <ol data-testid="tool-call-timeline" className="mt-2 space-y-0.5 border-l border-default pl-3">
      {calls.map((c) => {
        const s = STATUS[c.status] || STATUS.started;
        const Icon = s.icon;
        const id = c.callId || `${c.step}:${c.tool?.action}`;
        // `tool.name` is the sanitized name the model saw (`<connection>__<tool>`);
        // the monitor shows the tool's own name, as spec/37 §6's example does.
        const name = c.tool?.action || c.tool?.name || 'tool';
        const open = openId === id;
        return (
          <li key={id} data-status={c.status} className="relative text-xs">
            <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full border border-default bg-surface" aria-hidden="true" />
            <button type="button" onClick={() => setOpenId(open ? null : id)} aria-expanded={open} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-bg-subtle">
              <ChevronRight className={cx('h-3 w-3 shrink-0 text-subtle transition-transform', open && 'rotate-90')} aria-hidden="true" />
              <span className="shrink-0 tabular-nums text-subtle">step {c.step}</span>
              <span className="text-subtle" aria-hidden="true">→</span>
              <code className="truncate font-mono font-medium text-fg">{name}<span className="text-subtle">({argsPreview(c.args)})</span></code>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                {c.cached && <Badge tone="info" size="xs">cached</Badge>}
                {c.sandbox && <Badge size="xs">sandbox</Badge>}
                {typeof c.durationMs === 'number' && <span className="tabular-nums text-subtle">{c.durationMs} ms</span>}
                <Icon className={cx('h-3.5 w-3.5', s.tone, s.spin && 'animate-spin')} aria-label={s.label} />
              </span>
            </button>
            {c.status === 'failed' && c.error && <p className="ml-5 mt-0.5 text-danger">{c.error}</p>}
            {open && (
              <div className="ml-5 mt-1.5 space-y-2 pb-1">
                <JsonBlock label="Arguments" value={c.args ?? {}} />
                {c.output !== undefined && <JsonBlock label="Output" value={c.output} />}
              </div>
            )}
          </li>
        );
      })}
      {finished && (
        <li className="relative flex items-center gap-1.5 px-1 py-0.5 text-xs text-subtle">
          <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-success" aria-hidden="true" />
          <Flag className="ml-4 h-3 w-3" aria-hidden="true" />
          step {Math.max(agentSteps || 0, ...calls.map((c) => (c.step || 0) + 1))} → final answer
        </li>
      )}
    </ol>
  );
}

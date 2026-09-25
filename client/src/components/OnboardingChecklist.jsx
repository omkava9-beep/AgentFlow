import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOnboarding, dismissOnboarding } from '../api/onboarding';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { Check, Sparkles } from 'lucide-react';
import { Button } from './ui/index';

// Order and copy for the six steps (spec/36 §2). Where each gets done: most
// happen inside a workflow, so they point at the dashboard's workflow list.
const STEP_COPY = {
  create_workflow: { title: 'Create a workflow', hint: 'Start blank or from a template.', to: '/templates' },
  run_workflow: { title: 'Run it', hint: 'Open a workflow and press Test run.', to: '/dashboard' },
  invite_teammate: { title: 'Invite a teammate', hint: 'Build together in real time.', to: '/settings/members' },
  add_connection: { title: 'Add a connection', hint: 'Slack, GitHub, an MCP server…', to: '/connections' },
  publish_version: { title: 'Publish a version', hint: 'Triggers run the published version.', to: '/dashboard' },
  set_up_trigger: { title: 'Set up a trigger', hint: 'A schedule, webhook or event.', to: '/dashboard' },
};

/**
 * The Dashboard's getting-started card. Every tick comes from the server's view
 * of real data, never from local state, so it can't claim a step you haven't
 * done. `refreshKey` re-reads it after the dashboard changes something.
 */
export default function OnboardingChecklist({ refreshKey = 0 }) {
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  const wp = useWorkspacePath();
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!workspaceId) return undefined;
    let cancelled = false;
    getOnboarding(workspaceId)
      .then((data) => !cancelled && setState(data))
      .catch(() => !cancelled && setState(null));
    return () => { cancelled = true; };
  }, [workspaceId, refreshKey]);

  if (!state || state.dismissed || state.complete) return null;
  const doneCount = state.steps.filter((s) => s.done).length;

  async function handleDismiss() {
    setState((s) => ({ ...s, dismissed: true }));
    try { await dismissOnboarding(workspaceId); } catch { /* shown again next visit; harmless */ }
  }

  return (
    <section className="mb-6 rounded-card border border-default bg-surface p-4" data-testid="onboarding-checklist">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-subtle-fg">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">Get started with AgentFlow</h2>
            <p className="text-xs text-muted">{doneCount} of {state.steps.length} done</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-bg-subtle sm:block" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneCount / state.steps.length) * 100}%` }} />
          </div>
          <Button variant="ghost" size="sm" onClick={handleDismiss}>Dismiss</Button>
        </div>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {state.steps.map((step) => {
          const copy = STEP_COPY[step.key] || { title: step.key, hint: '', to: '/dashboard' };
          const body = (
            <>
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                  step.done ? 'bg-success text-white' : 'border border-strong'
                }`}
              >
                {step.done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm ${step.done ? 'text-subtle line-through' : 'font-medium text-fg'}`}>{copy.title}</span>
                {!step.done && (
                  <span className="block text-xs text-muted">{step.canDo ? copy.hint : 'Ask an admin to do this one'}</span>
                )}
              </span>
            </>
          );
          const cls = 'flex items-start gap-2.5 rounded-control border border-default px-3 py-2.5';
          return (
            <li key={step.key}>
              {!step.done && step.canDo ? (
                <Link to={wp(copy.to)} className={`${cls} transition-colors hover:border-strong hover:bg-bg-subtle/60`}>{body}</Link>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

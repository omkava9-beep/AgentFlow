import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOnboarding, dismissOnboarding } from '../api/onboarding';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { Card } from './ui';

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
    <Card className="mb-6 p-5" data-testid="onboarding-checklist">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Get started with AgentFlow</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{doneCount} of {state.steps.length} done</p>
        </div>
        <button type="button" onClick={handleDismiss} className="text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          Dismiss
        </button>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-purple-600 transition-all" style={{ width: `${(doneCount / state.steps.length) * 100}%` }} />
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {state.steps.map((step) => {
          const copy = STEP_COPY[step.key] || { title: step.key, hint: '', to: '/dashboard' };
          return (
            <li key={step.key} className="flex items-start gap-2 rounded-lg border border-slate-100 p-2.5 dark:border-slate-800">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                  step.done ? 'bg-emerald-500 text-white' : 'border border-slate-300 dark:border-slate-600'
                }`}
              >
                {step.done ? '✓' : ''}
              </span>
              <div className="min-w-0">
                {step.done ? (
                  <p className="text-sm text-slate-400 line-through">{copy.title}</p>
                ) : step.canDo ? (
                  <Link to={wp(copy.to)} className="text-sm font-medium text-slate-800 hover:text-brand-600 dark:text-slate-200">{copy.title}</Link>
                ) : (
                  <p className="text-sm text-slate-600 dark:text-slate-300">{copy.title} <span className="text-xs text-slate-400">· ask an admin</span></p>
                )}
                {!step.done && <p className="text-xs text-slate-500 dark:text-slate-400">{copy.hint}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

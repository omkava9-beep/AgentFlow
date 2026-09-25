import { useNavigate } from 'react-router-dom';
import { Avatar, Tooltip } from './ui/index';
import { formatRelativeTime } from '../utils/time';
import { Activity, IntegrationStack, LastRun, TriggerIcons, VersionBadge } from './workflows/parts';
import { triggerLine } from './workflows/workflowMeta';
import WorkflowActions from './workflows/WorkflowActions';

/**
 * Grid view of a workflow: what it touches (integration marks), where it
 * stands (version), what starts it, how its last run went and how busy it's
 * been - so cards differ at a glance instead of all looking the same.
 */
export default function WorkflowCard({ workflow, wp, names, actions }) {
  const navigate = useNavigate();
  const open = () => navigate(wp(`/workflows/${workflow._id}`));
  const person = workflow.updatedBy || workflow.createdBy;

  return (
    <div
      role="link"
      tabIndex={0}
      data-testid="workflow-card"
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
      className="group flex cursor-pointer flex-col rounded-card border border-default bg-surface p-4 transition-colors hover:border-strong hover:bg-bg-subtle/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <div className="flex items-start justify-between gap-2">
        <IntegrationStack workflow={workflow} names={names} max={5} size="md" />
        <WorkflowActions workflow={workflow} wp={wp} {...actions} className="-mr-1 -mt-1 opacity-60 transition-opacity group-hover:opacity-100" />
      </div>

      <div className="mt-3 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-fg">{workflow.name}</h3>
        </div>
        <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted">
          <TriggerIcons workflow={workflow} />
          <span className="truncate">{triggerLine(workflow, names)}</span>
        </p>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <VersionBadge workflow={workflow} />
        <span className="text-2xs tabular-nums text-subtle">{workflow.nodeCount} {workflow.nodeCount === 1 ? 'node' : 'nodes'}</span>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3 border-t border-default pt-3">
        <div className="min-w-0 space-y-1.5">
          <LastRun workflow={workflow} wp={wp} />
          <div className="flex items-center gap-1.5 text-2xs text-subtle">
            {person && (
              <Tooltip content={person.name || person.email}>
                <span><Avatar name={person.name} email={person.email} seed={person.id} size="xs" /></span>
              </Tooltip>
            )}
            <span className="truncate">Updated {formatRelativeTime(workflow.updatedAt)}</span>
          </div>
        </div>
        <Activity workflow={workflow} />
      </div>
    </div>
  );
}

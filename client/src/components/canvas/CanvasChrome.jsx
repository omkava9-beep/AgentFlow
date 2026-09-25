import { Map as MapIcon, Magnet, Activity, Play, MousePointerClick, LayoutTemplate, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import Tooltip from '../ui/Tooltip';
import { StatusIcon } from '../ui/Badge';
import Button from '../ui/Button';
import { cx } from '../ui/cx';
import { useCanvasUi } from './canvasUiStore';
import AddNodeMenu from './AddNodeMenu';
import { useWorkspacePath } from '../../hooks/useWorkspacePath';

const ago = (iso) => {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

/**
 * Canvas chrome that isn't React Flow's: the bottom-right view toggles
 * (minimap, snap to grid, last-run overlay), the positioned "Add node" menu
 * every add affordance opens, and the empty-canvas onboarding card.
 */
export default function CanvasChrome({ canEdit, empty, onPick, onAddStart, showMinimap }) {
  const snap = useCanvasUi((s) => s.snapToGrid);
  const overlay = useCanvasUi((s) => s.showRunOverlay);
  const latestRun = useCanvasUi((s) => s.latestRun);
  const addRequest = useCanvasUi((s) => s.addRequest);
  const wp = useWorkspacePath();
  const ui = useCanvasUi.getState;

  // A node can't be inserted mid-edge as Start or End, nor wired after an End.
  const exclude = addRequest?.kind === 'edge'
    ? ['start', 'end']
    : addRequest?.kind === 'connect'
      ? (addRequest.from?.handleType === 'target' ? ['end'] : ['start'])
      : [];

  return (
    <>
      {!canEdit && (
        // Viewers (spec/23): say why nothing can be edited, without a banner over the graph.
        <div data-testid="readonly-chip" className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1 text-xs font-medium text-muted shadow-sm">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Read-only — your role can view this workflow but not edit or run it
          </span>
        </div>
      )}
      <div data-testid="canvas-view-toggles" className="absolute bottom-4 right-4 z-10 flex items-center gap-0.5 rounded-control border border-default bg-surface p-0.5 shadow-sm">
        <Toggle label={showMinimap ? 'Hide minimap' : 'Show minimap'} active={showMinimap} onClick={() => ui().toggleMinimap(showMinimap)} icon={MapIcon} testId="toggle-minimap" />
        {canEdit && <Toggle label={snap ? 'Snap to grid: on' : 'Snap to grid: off'} active={snap} onClick={() => ui().toggleSnap()} icon={Magnet} testId="toggle-snap" />}
        <Toggle
          label={latestRun ? `${overlay ? 'Hide' : 'Show'} the latest run (${latestRun.status}, ${ago(latestRun.startedAt || latestRun.createdAt)})` : 'No runs yet'}
          active={overlay}
          disabled={!latestRun}
          onClick={() => ui().toggleRunOverlay()}
          icon={Activity}
          testId="toggle-run-overlay"
          badge={latestRun ? <StatusIcon status={latestRun.status} className="h-3 w-3" /> : null}
        />
      </div>

      {canEdit && (
        <AddNodeMenu
          open={Boolean(addRequest)}
          onOpenChange={(open) => { if (!open) ui().clearAddRequest(); }}
          position={addRequest?.screen || { x: 0, y: 0 }}
          exclude={exclude}
          onPick={onPick}
        />
      )}

      {empty && (
        <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center p-6">
          <div data-testid="canvas-empty" className="pointer-events-auto w-full max-w-sm rounded-card border border-default bg-surface p-6 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-subtle text-accent-subtle-fg">
              <Play className="h-5 w-5" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold text-fg">Add a trigger to get started</h3>
            <p className="mt-1 text-xs text-muted">Every workflow begins with a Start node. Then chain agents, integrations and logic after it.</p>
            {canEdit ? (
              <div className="mt-4 flex flex-col items-center gap-2">
                <Button onClick={onAddStart} data-testid="empty-add-start"><Play className="h-3.5 w-3.5" aria-hidden="true" /> Add a Start node</Button>
                <Link to={wp('/templates')} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                  <LayoutTemplate className="h-3.5 w-3.5" aria-hidden="true" /> or start from a template
                </Link>
                <p className="mt-2 flex items-center gap-1 text-2xs text-subtle">
                  <MousePointerClick className="h-3 w-3" aria-hidden="true" /> Tip: double-click or right-click the canvas to add a node anywhere.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-subtle">This workflow is empty.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Toggle({ label, active, onClick, icon: Icon, disabled = false, testId, badge = null }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        data-testid={testId}
        className={cx(
          'relative inline-flex h-7 w-7 items-center justify-center rounded-[5px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
          active ? 'bg-accent-subtle text-accent-subtle-fg' : 'text-muted hover:bg-bg-subtle hover:text-fg',
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {badge && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-surface">{badge}</span>}
      </button>
    </Tooltip>
  );
}

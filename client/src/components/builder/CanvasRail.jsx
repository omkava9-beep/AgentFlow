import { useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus, Zap } from 'lucide-react';
import AddNodeMenu from '../canvas/AddNodeMenu';
import { NODE_DRAG_TYPE, NODE_HINTS, nodeLabel } from '../nodeCatalog';
import NodeTypeIcon from '../ui/NodeTypeIcon';
import Tooltip from '../ui/Tooltip';
import Kbd from '../ui/Kbd';
import { cx } from '../ui/cx';

// The node types people add most often get a one-click slot on the rail.
const QUICK = ['agent', 'tool', 'condition', 'approval', 'transform'];

const STORAGE_KEY = 'agentflow.builder.palette';

// Expanded by default: a first-time user needs the labels to know what the
// buttons are. The collapsed icon rail is an opt-in for people who know them.
function readExpanded() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'collapsed';
  } catch {
    return true;
  }
}

function writeExpanded(expanded) {
  try {
    localStorage.setItem(STORAGE_KEY, expanded ? 'expanded' : 'collapsed');
  } catch {
    // Private mode / blocked storage: the choice just isn't remembered.
  }
}

function dragProps(type) {
  return {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(NODE_DRAG_TYPE, type);
      e.dataTransfer.effectAllowed = 'move';
    },
  };
}

/**
 * The Builder's left panel: "Add node" (the searchable node menu, also on ⌘/),
 * quick-add rows for the common types (click to add at the view's centre, or
 * drag onto the canvas) and the Triggers flyout toggle. Expanded with labels by
 * default; collapses to a slim icon rail, remembered per browser.
 */
export default function CanvasRail({ canEdit, menuOpen, onMenuOpenChange, onAdd, triggersOpen, onToggleTriggers }) {
  const [expanded, setExpanded] = useState(readExpanded);
  const toggle = () => setExpanded((v) => { writeExpanded(!v); return !v; });

  if (!expanded) {
    const railButton = (active) => cx(
      'relative flex h-9 w-9 items-center justify-center rounded-md transition-colors',
      active ? 'bg-accent-subtle text-accent-subtle-fg' : 'text-muted hover:bg-bg-subtle hover:text-fg',
    );
    return (
      <div data-testid="canvas-rail" data-expanded="false" className="relative z-20 flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-default bg-surface py-2">
        {canEdit && (
          <>
            <AddNodeMenu open={menuOpen} onOpenChange={onMenuOpenChange} onPick={onAdd} side="right">
              <button
                type="button"
                data-testid="add-node"
                aria-label="Add node (⌘/)"
                className={cx('flex h-9 w-9 items-center justify-center rounded-md shadow-sm transition-colors', menuOpen ? 'bg-accent-hover text-accent-fg' : 'bg-accent text-accent-fg hover:bg-accent-hover')}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </AddNodeMenu>
            <div className="my-1 h-px w-6 bg-[rgb(var(--border))]" aria-hidden="true" />
            {QUICK.map((type) => (
              <Tooltip key={type} content={`${nodeLabel(type)} — ${NODE_HINTS[type]}`} side="right">
                <button type="button" data-testid={`add-node-${type}`} aria-label={`Add ${nodeLabel(type)} node`} onClick={() => onAdd(type)} className={railButton(false)} {...dragProps(type)}>
                  <NodeTypeIcon type={type} size="md" />
                </button>
              </Tooltip>
            ))}
            <div className="my-1 h-px w-6 bg-[rgb(var(--border))]" aria-hidden="true" />
          </>
        )}
        <Tooltip content="Triggers" side="right">
          <button type="button" data-testid="triggers-toggle" aria-label="Triggers" aria-pressed={triggersOpen} onClick={onToggleTriggers} className={railButton(triggersOpen)}>
            <Zap className="h-4 w-4" aria-hidden="true" />
          </button>
        </Tooltip>
        <div className="mt-auto">
          <Tooltip content="Show labels" side="right">
            <button type="button" data-testid="palette-expand" aria-label="Expand node panel" onClick={toggle} className={railButton(false)}>
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>
    );
  }

  const row = (active) => cx(
    'group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
    active ? 'bg-accent-subtle text-accent-subtle-fg' : 'text-fg hover:bg-bg-subtle',
  );

  return (
    <div data-testid="canvas-rail" data-expanded="true" className="relative z-20 flex w-[220px] shrink-0 flex-col border-r border-default bg-surface">
      <div className="flex flex-col gap-3 overflow-y-auto p-3">
        {canEdit && (
          <>
            <AddNodeMenu open={menuOpen} onOpenChange={onMenuOpenChange} onPick={onAdd} side="right">
              <button
                type="button"
                data-testid="add-node"
                aria-label="Add node (⌘/)"
                className={cx('flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm font-medium shadow-sm transition-colors', menuOpen ? 'bg-accent-hover text-accent-fg' : 'bg-accent text-accent-fg hover:bg-accent-hover')}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add node
                <Kbd className="ml-auto border-transparent bg-white/15 text-accent-fg">⌘/</Kbd>
              </button>
            </AddNodeMenu>

            <div>
              <div className="flex items-baseline justify-between px-2 pb-1"><span className="text-[11px] font-medium uppercase tracking-wide text-subtle">Common</span><span className="text-[11px] text-subtle">click or drag</span></div>
              <div className="flex flex-col gap-0.5">
                {QUICK.map((type) => (
                  <button
                    key={type}
                    type="button"
                    data-testid={`add-node-${type}`}
                    aria-label={`Add ${nodeLabel(type)} node`}
                    onClick={() => onAdd(type)}
                    className={row(false)}
                    {...dragProps(type)}
                  >
                    <NodeTypeIcon type={type} size="md" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium leading-5">{nodeLabel(type)}</span>
                      <span className="block truncate text-xs leading-4 text-subtle">{NODE_HINTS[type]}</span>
                    </span>
                  </button>
                ))}
                <button type="button" onClick={() => onMenuOpenChange(true)} className="mt-0.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-accent hover:bg-bg-subtle">
                  Browse all nodes…
                </button>
              </div>
            </div>
          </>
        )}

        <div>
          <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-subtle">Start this workflow</div>
          <button type="button" data-testid="triggers-toggle" aria-pressed={triggersOpen} onClick={onToggleTriggers} className={row(triggersOpen)}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bg-subtle text-muted">
              <Zap className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium leading-5">Triggers</span>
              <span className="block truncate text-xs leading-4 text-subtle">Schedule, webhook, events</span>
            </span>
          </button>
        </div>
      </div>

      <div className="mt-auto border-t border-default p-2">
        <button type="button" data-testid="palette-collapse" onClick={toggle} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted hover:bg-bg-subtle hover:text-fg">
          <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          Collapse panel
        </button>
      </div>
    </div>
  );
}

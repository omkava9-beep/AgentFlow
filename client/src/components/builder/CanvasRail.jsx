import { Plus, Zap } from 'lucide-react';
import AddNodeMenu from '../canvas/AddNodeMenu';
import { NODE_DRAG_TYPE, nodeLabel } from '../nodeCatalog';
import NodeTypeIcon from '../ui/NodeTypeIcon';
import Tooltip from '../ui/Tooltip';
import { cx } from '../ui/cx';

// The node types people add most often get a one-click slot on the rail.
const QUICK = ['agent', 'tool', 'condition', 'approval', 'transform'];

/**
 * The Builder's slim left rail (~52px): "Add node" (opens the searchable node
 * menu, also on ⌘/), quick-add buttons for the common types (click to add at the
 * view's centre, or drag onto the canvas), and the Triggers flyout toggle.
 */
export default function CanvasRail({ canEdit, menuOpen, onMenuOpenChange, onAdd, triggersOpen, onToggleTriggers }) {
  const railButton = (active) => cx(
    'relative flex h-9 w-9 items-center justify-center rounded-md transition-colors',
    active ? 'bg-accent-subtle text-accent-subtle-fg' : 'text-muted hover:bg-bg-subtle hover:text-fg',
  );

  return (
    <div data-testid="canvas-rail" className="relative z-20 flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-default bg-surface py-2">
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
            <Tooltip key={type} content={`${nodeLabel(type)} — click or drag`} side="right">
              <button
                type="button"
                data-testid={`add-node-${type}`}
                aria-label={`Add ${nodeLabel(type)} node`}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData(NODE_DRAG_TYPE, type); e.dataTransfer.effectAllowed = 'move'; }}
                onClick={() => onAdd(type)}
                className={railButton(false)}
              >
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
    </div>
  );
}

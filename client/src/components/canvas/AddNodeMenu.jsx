import { useMemo } from 'react';
import { Command } from 'cmdk';
import { Lock, Search } from 'lucide-react';
import NodeTypeIcon from '../ui/NodeTypeIcon';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../ui/Popover';
import { NODE_GROUPS, NODE_HINTS, NODE_DRAG_TYPE, nodeLabel } from '../nodeCatalog';
import { useCan } from '../../hooks/useCan';
import { useIntegrationStore } from '../../store/integrationStore';

/**
 * The searchable node list (cmdk): grouped compact rows, fuzzy search,
 * keyboard navigation, and every row draggable onto the canvas. Use it
 * directly inside any container, or through <AddNodeMenu> below.
 */
export function AddNodeList({ onPick, allowDrag = true, exclude = [] }) {
  const canAuthorCode = useCan('code:author');
  // The operator can switch Code off for the whole deployment (CODE_NODE_ENABLED).
  const codeNodeEnabled = useIntegrationStore((s) => s.features?.codeNode !== false);
  const groups = useMemo(() => NODE_GROUPS.map((g) => ({
    ...g,
    types: g.types.filter((t) => (t !== 'code' || codeNodeEnabled) && !exclude.includes(t)),
  })).filter((g) => g.types.length), [codeNodeEnabled, exclude]);

  return (
    <Command label="Add node" className="flex flex-col" loop data-testid="add-node-menu">
      <div className="flex items-center gap-2 border-b border-default px-3">
        <Search className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />
        <Command.Input
          autoFocus
          placeholder="Search nodes…"
          aria-label="Search nodes"
          className="h-10 w-full bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
        />
      </div>
      <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
        <Command.Empty className="px-2 py-6 text-center text-xs text-subtle">No node matches.</Command.Empty>
        {groups.map((group) => (
          <Command.Group
            key={group.title}
            heading={group.title}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle"
          >
            {group.types.map((type) => {
              const locked = type === 'code' && !canAuthorCode;
              return (
                <Command.Item
                  key={type}
                  value={`${nodeLabel(type)} ${NODE_HINTS[type]} ${group.title}`}
                  disabled={locked}
                  onSelect={() => onPick(type)}
                  data-testid={`palette-${type}`}
                  className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none data-[disabled=true]:opacity-45 data-[selected=true]:bg-bg-subtle"
                >
                  <span
                    draggable={allowDrag && !locked}
                    onDragStart={(e) => { e.dataTransfer.setData(NODE_DRAG_TYPE, type); e.dataTransfer.effectAllowed = 'move'; }}
                    className="flex min-w-0 flex-1 items-center gap-2.5"
                    title={locked ? 'Adding a Code node needs the code:author permission (owner or admin)' : undefined}
                  >
                    <NodeTypeIcon type={type} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{nodeLabel(type)}</span>
                    <span className="truncate text-2xs text-subtle">{NODE_HINTS[type]}</span>
                    {locked && <Lock className="h-3 w-3 shrink-0 text-subtle" aria-hidden="true" />}
                  </span>
                </Command.Item>
              );
            })}
          </Command.Group>
        ))}
      </Command.List>
      <div className="flex items-center justify-between border-t border-default bg-bg-subtle/50 px-3 py-1.5 text-2xs text-subtle">
        <span>↑↓ to move · ↵ to add{allowDrag ? ' · or drag' : ''}</span>
        <span>⌘/</span>
      </div>
    </Command>
  );
}

/**
 * "Add node" as a popover. Either wrap a trigger (`children`), or position it
 * at a point with `position={{ x, y }}` in viewport pixels (for "Add node
 * here" on the pane's context menu, or inserting on an edge) and control it
 * with `open` / `onOpenChange`.
 *
 *   <AddNodeMenu onPick={(type) => add(type)}><button>+</button></AddNodeMenu>
 *   <AddNodeMenu open={o} onOpenChange={setO} position={{ x, y }} onPick={…} />
 */
export default function AddNodeMenu({ onPick, children, open, onOpenChange, position = null, side = 'right', align = 'start', exclude }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {position ? (
        <PopoverAnchor asChild>
          <span aria-hidden="true" style={{ position: 'fixed', left: position.x, top: position.y, width: 1, height: 1 }} />
        </PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      )}
      <PopoverContent side={position ? 'bottom' : side} align={align} padded={false} className="w-[320px] overflow-hidden">
        <AddNodeList
          exclude={exclude}
          onPick={(type) => { onPick(type); onOpenChange?.(false); }}
        />
      </PopoverContent>
    </Popover>
  );
}

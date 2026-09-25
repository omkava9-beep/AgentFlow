import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Search } from 'lucide-react';
import NodeTypeIcon from './ui/NodeTypeIcon';
import { NODE_GROUPS, NODE_HINTS, NODE_DRAG_TYPE, nodeLabel } from './nodeCatalog';
import { useCan } from '../hooks/useCan';
import { useIntegrationStore } from '../store/integrationStore';
import { cx } from './ui/cx';

/**
 * The searchable "Add node" list: compact grouped rows (icon + name, hint on
 * the right), keyboard navigable, and each row draggable onto the canvas.
 * Rendered inside the canvas rail's popover.
 */
export default function NodePalette({ onAdd, autoFocus = false }) {
  const canAuthorCode = useCan('code:author');
  // The operator can switch Code off for the whole deployment (CODE_NODE_ENABLED).
  const codeNodeEnabled = useIntegrationStore((s) => s.features?.codeNode !== false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return NODE_GROUPS.map((g) => ({
      ...g,
      types: g.types
        .filter((type) => type !== 'code' || codeNodeEnabled)
        .filter((type) => !q || `${nodeLabel(type)} ${NODE_HINTS[type]} ${g.title}`.toLowerCase().includes(q)),
    })).filter((g) => g.types.length);
  }, [query, codeNodeEnabled]);

  const flat = groups.flatMap((g) => g.types);
  const locked = (type) => type === 'code' && !canAuthorCode;

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && flat[active] && !locked(flat[active])) { e.preventDefault(); onAdd(flat[active]); }
  }

  let index = -1;
  return (
    <div className="flex flex-col" onKeyDown={onKeyDown}>
      <div className="relative border-b border-default p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          placeholder="Search nodes…"
          aria-label="Search nodes"
          className="h-8 w-full rounded-control border border-default bg-surface pl-7 pr-2 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-1.5" role="listbox" aria-label="Node types">
        {groups.map((group) => (
          <div key={group.title} className="mb-1 last:mb-0">
            <h4 className="px-2 pb-0.5 pt-1.5 text-2xs font-medium uppercase tracking-wider text-subtle">{group.title}</h4>
            {group.types.map((type) => {
              index += 1;
              const i = index;
              const isLocked = locked(type);
              return (
                <button
                  key={type}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-testid={`palette-${type}`}
                  draggable={!isLocked}
                  onDragStart={(e) => { e.dataTransfer.setData(NODE_DRAG_TYPE, type); e.dataTransfer.effectAllowed = 'move'; }}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => !isLocked && onAdd(type)}
                  disabled={isLocked}
                  title={isLocked ? 'Adding a Code node needs the code:author permission (owner or admin)' : undefined}
                  className={cx(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    i === active ? 'bg-bg-subtle' : 'hover:bg-bg-subtle',
                  )}
                >
                  <NodeTypeIcon type={type} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{nodeLabel(type)}</span>
                  <span className="truncate text-2xs text-subtle">{NODE_HINTS[type]}</span>
                  {isLocked && <Lock className="h-3 w-3 shrink-0 text-subtle" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        ))}
        {!groups.length && <p className="px-2 py-4 text-center text-xs text-subtle">No node matches “{query}”.</p>}
      </div>
      <div className="flex items-center justify-between border-t border-default bg-bg-subtle/50 px-3 py-1.5 text-2xs text-subtle">
        <span>Click or drag onto the canvas</span>
        <span>⌘/ to open</span>
      </div>
    </div>
  );
}

import {
  Settings2, PencilLine, CopyPlus, Copy, Scissors, Trash2, EyeOff, Eye, MessageSquarePlus, SquareTerminal, Hash,
  BookOpen, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal,
  AlignEndHorizontal, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, LayoutGrid, Plus, ClipboardPaste,
  BoxSelect, Maximize, Search, Undo2, Redo2, Tag, SplitSquareHorizontal,
} from 'lucide-react';
import {
  ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuLabel, ContextMenuSub, ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '../ui/ContextMenu';
import { isConditionEdge } from '../../store/workflowStore';
import { nodeLabel } from '../nodeCatalog';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
const DEL = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌫' : 'Del';

const cannotDisable = (node) => node?.type === 'start' || node?.type === 'end';

/**
 * The canvas's right-click menu. One Radix ContextMenu wraps the whole canvas;
 * React Flow's node/edge/pane context-menu callbacks set `target` first (they
 * fire on the inner element, before the menu opens), so the content matches
 * whatever was right-clicked. Every edit goes through `actions` → the collab
 * store, so it syncs, undoes and is refused for viewers like any other edit.
 *
 * target:
 *   { kind: 'node', node }                 one node
 *   { kind: 'selection', nodes }           several selected nodes
 *   { kind: 'edge', edge }
 *   { kind: 'pane', flow, screen }
 */
export default function CanvasContextMenu({ target, actions, perms, state }) {
  if (!target) return <ContextMenuContent className="hidden" />;
  const { canEdit, canComment } = perms;

  return (
    <ContextMenuContent data-testid={`canvas-menu-${target.kind}`} className="w-60">
      {target.kind === 'node' && <NodeItems node={target.node} actions={actions} canEdit={canEdit} canComment={canComment} state={state} />}
      {target.kind === 'selection' && <SelectionItems nodes={target.nodes} actions={actions} canEdit={canEdit} />}
      {target.kind === 'edge' && <EdgeItems edge={target.edge} actions={actions} canEdit={canEdit} />}
      {target.kind === 'pane' && <PaneItems target={target} actions={actions} canEdit={canEdit} canComment={canComment} state={state} />}
    </ContextMenuContent>
  );
}

function NodeItems({ node, actions, canEdit, canComment, state }) {
  const ids = [node.id];
  const disabled = Boolean(node.data?.config?.disabled);
  const label = node.data?.config?.label || nodeLabel(node.type);
  return (
    <>
      <ContextMenuLabel>{label}</ContextMenuLabel>
      <ContextMenuItem icon={Settings2} shortcut="↵" onSelect={() => actions.openSettings(node.id)}>Open settings</ContextMenuItem>
      {canEdit && <ContextMenuItem icon={PencilLine} shortcut="F2" onSelect={() => actions.rename(node.id)}>Rename</ContextMenuItem>}
      <ContextMenuSeparator />
      {canEdit && <ContextMenuItem icon={CopyPlus} shortcut={`${MOD}D`} disabled={node.type === 'start'} onSelect={() => actions.duplicate(ids)}>Duplicate</ContextMenuItem>}
      <ContextMenuItem icon={Copy} shortcut={`${MOD}C`} onSelect={() => actions.copy(ids)}>Copy</ContextMenuItem>
      {canEdit && <ContextMenuItem icon={Scissors} shortcut={`${MOD}X`} onSelect={() => actions.cut(ids)}>Cut</ContextMenuItem>}
      {canEdit && !cannotDisable(node) && (
        <ContextMenuItem icon={disabled ? Eye : EyeOff} shortcut="⇧D" onSelect={() => actions.setDisabled(ids, !disabled)}>
          {disabled ? 'Enable node' : 'Disable node'}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      {canComment && <ContextMenuItem icon={MessageSquarePlus} onSelect={() => actions.commentOnNode(node.id)}>Add comment</ContextMenuItem>}
      <ContextMenuItem icon={SquareTerminal} disabled={!state.hasRunResult(node.id)} onSelect={() => actions.viewOutput(node.id)}>
        View last run output
      </ContextMenuItem>
      <ContextMenuItem icon={Hash} onSelect={() => actions.copyId(node.id)}>Copy node ID</ContextMenuItem>
      <ContextMenuItem icon={BookOpen} onSelect={() => actions.docs(node.id)}>Documentation</ContextMenuItem>
      {canEdit && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem icon={Trash2} shortcut={DEL} destructive onSelect={() => actions.remove(ids)}>Delete</ContextMenuItem>
        </>
      )}
    </>
  );
}

function SelectionItems({ nodes, actions, canEdit }) {
  const ids = nodes.map((n) => n.id);
  const disablable = nodes.filter((n) => !cannotDisable(n));
  const allDisabled = disablable.length > 0 && disablable.every((n) => n.data?.config?.disabled);
  return (
    <>
      <ContextMenuLabel>{nodes.length} nodes selected</ContextMenuLabel>
      {canEdit && <ContextMenuItem icon={CopyPlus} shortcut={`${MOD}D`} onSelect={() => actions.duplicate(ids)}>Duplicate</ContextMenuItem>}
      <ContextMenuItem icon={Copy} shortcut={`${MOD}C`} onSelect={() => actions.copy(ids)}>Copy</ContextMenuItem>
      {canEdit && <ContextMenuItem icon={Scissors} shortcut={`${MOD}X`} onSelect={() => actions.cut(ids)}>Cut</ContextMenuItem>}
      {canEdit && disablable.length > 0 && (
        <ContextMenuItem icon={allDisabled ? Eye : EyeOff} shortcut="⇧D" onSelect={() => actions.setDisabled(disablable.map((n) => n.id), !allDisabled)}>
          {allDisabled ? 'Enable nodes' : 'Disable nodes'}
        </ContextMenuItem>
      )}
      {canEdit && (
        <>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger icon={AlignStartVertical}>Align</ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              <ContextMenuItem icon={AlignStartVertical} onSelect={() => actions.align('left', ids)}>Left</ContextMenuItem>
              <ContextMenuItem icon={AlignCenterVertical} onSelect={() => actions.align('center', ids)}>Center</ContextMenuItem>
              <ContextMenuItem icon={AlignEndVertical} onSelect={() => actions.align('right', ids)}>Right</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem icon={AlignStartHorizontal} onSelect={() => actions.align('top', ids)}>Top</ContextMenuItem>
              <ContextMenuItem icon={AlignCenterHorizontal} onSelect={() => actions.align('middle', ids)}>Middle</ContextMenuItem>
              <ContextMenuItem icon={AlignEndHorizontal} onSelect={() => actions.align('bottom', ids)}>Bottom</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger icon={AlignHorizontalDistributeCenter}>Distribute</ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              <ContextMenuItem icon={AlignHorizontalDistributeCenter} disabled={nodes.length < 3} onSelect={() => actions.distribute('horizontal', ids)}>Horizontally</ContextMenuItem>
              <ContextMenuItem icon={AlignVerticalDistributeCenter} disabled={nodes.length < 3} onSelect={() => actions.distribute('vertical', ids)}>Vertically</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem icon={LayoutGrid} onSelect={() => actions.autoLayout(ids)}>Tidy up selection</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={Trash2} shortcut={DEL} destructive onSelect={() => actions.remove(ids)}>Delete {nodes.length} nodes</ContextMenuItem>
        </>
      )}
    </>
  );
}

function EdgeItems({ edge, actions, canEdit }) {
  const lockedLabel = isConditionEdge(edge) || edge.sourceHandle === 'approved' || edge.sourceHandle === 'rejected' || edge.sourceHandle === 'error';
  return (
    <>
      <ContextMenuLabel>Connection{edge.label ? ` · ${edge.label}` : ''}</ContextMenuLabel>
      {canEdit ? (
        <>
          <ContextMenuItem icon={SplitSquareHorizontal} onSelect={() => actions.insertOnEdge(edge.id)}>Insert node here</ContextMenuItem>
          <ContextMenuItem icon={Tag} disabled={lockedLabel} onSelect={() => actions.editEdgeLabel(edge.id)}>
            {lockedLabel ? 'Label set by the branch' : 'Edit label'}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={Trash2} shortcut={DEL} destructive onSelect={() => actions.deleteEdge(edge.id)}>Delete connection</ContextMenuItem>
        </>
      ) : (
        <ContextMenuItem icon={Settings2} onSelect={() => actions.editEdgeLabel(edge.id)}>View details</ContextMenuItem>
      )}
    </>
  );
}

function PaneItems({ target, actions, canEdit, canComment, state }) {
  return (
    <>
      {canEdit && (
        <>
          <ContextMenuItem icon={Plus} shortcut={`${MOD}/`} onSelect={() => actions.addHere(target)}>Add node here</ContextMenuItem>
          <ContextMenuItem icon={ClipboardPaste} shortcut={`${MOD}V`} disabled={!state.canPaste} onSelect={() => actions.pasteHere(target.flow)}>Paste here</ContextMenuItem>
        </>
      )}
      <ContextMenuItem icon={BoxSelect} shortcut={`${MOD}A`} disabled={!state.hasNodes} onSelect={actions.selectAll}>Select all</ContextMenuItem>
      {canEdit && <ContextMenuItem icon={LayoutGrid} disabled={!state.hasNodes} onSelect={() => actions.autoLayout(null)}>Auto-layout</ContextMenuItem>}
      <ContextMenuSeparator />
      <ContextMenuItem icon={Maximize} shortcut="⇧1" disabled={!state.hasNodes} onSelect={actions.fitView}>Fit view</ContextMenuItem>
      <ContextMenuItem icon={Search} shortcut="⇧0" onSelect={actions.zoom100}>Zoom to 100%</ContextMenuItem>
      {canComment && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem icon={MessageSquarePlus} onSelect={() => actions.commentHere(target.flow)}>Add comment here</ContextMenuItem>
        </>
      )}
      {canEdit && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem icon={Undo2} shortcut={`${MOD}Z`} disabled={!state.canUndo} onSelect={actions.undo}>Undo</ContextMenuItem>
          <ContextMenuItem icon={Redo2} shortcut={`⇧${MOD}Z`} disabled={!state.canRedo} onSelect={actions.redo}>Redo</ContextMenuItem>
        </>
      )}
    </>
  );
}

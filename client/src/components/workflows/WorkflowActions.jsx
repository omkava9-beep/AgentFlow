import { useNavigate } from 'react-router-dom';
import { Copy, ExternalLink, History, MoreHorizontal, Play, Share2, Trash2 } from 'lucide-react';
import { Menu, MenuButton, MenuSeparator } from '../ui/index';
import { useCan } from '../../hooks/useCan';

/**
 * The ⋯ menu on a workflow row or card. Every item is gated by the same
 * permission the server enforces (spec/23), so a viewer only sees Open and
 * History.
 */
export default function WorkflowActions({ workflow, wp, onRunPublished, onDuplicate, onShare, onDelete, className = '' }) {
  const navigate = useNavigate();
  const canRun = useCan('workflow:run');
  const canEdit = useCan('workflow:edit');
  const canShare = useCan('share:manage');
  const open = () => navigate(wp(`/workflows/${workflow._id}`));

  return (
    // The trigger sits inside a clickable row/card; don't let it open the workflow.
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className={className}>
      <Menu
        label={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
        title="Workflow actions"
        align="right"
        testId="workflow-actions"
        buttonClassName="inline-flex h-7 w-7 items-center justify-center rounded-control text-subtle transition-colors hover:bg-bg-subtle hover:text-fg data-[state=open]:bg-bg-subtle data-[state=open]:text-fg"
        panelClassName="w-52"
      >
        <MenuButton onClick={open}><ExternalLink className="h-4 w-4" /> Open</MenuButton>
        <MenuButton onClick={() => navigate(wp(`/workflows/${workflow._id}/runs`))}><History className="h-4 w-4" /> Run history</MenuButton>
        {canRun && workflow.publishedVersion && (
          <MenuButton onClick={() => onRunPublished(workflow)}><Play className="h-4 w-4" /> Run published v{workflow.publishedVersion}</MenuButton>
        )}
        {canEdit && <MenuButton onClick={() => onDuplicate(workflow)}><Copy className="h-4 w-4" /> Duplicate</MenuButton>}
        {canShare && <MenuButton onClick={() => onShare(workflow)}><Share2 className="h-4 w-4" /> Share read-only link</MenuButton>}
        {canEdit && (
          <>
            <MenuSeparator />
            <MenuButton danger onClick={() => onDelete(workflow)}><Trash2 className="h-4 w-4" /> Delete</MenuButton>
          </>
        )}
      </Menu>
    </span>
  );
}

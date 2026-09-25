import { MoreHorizontal, Pencil, Trash2, Timer } from 'lucide-react';
import { Badge, IntegrationLogo, Menu, MenuButton, MenuSeparator, Tooltip, cx } from './ui/index';
import { TRIGGER_META } from './workflows/workflowMeta';
import { DIFFICULTY, categoryMeta, templateIcon, templateIntegrations } from './templates/templateMeta';

/**
 * A gallery card. The whole card opens the template's detail; using it is one
 * deliberate step there, not a giant button on every card. `onEdit` /
 * `onDelete` are passed only for workspace templates the caller may manage
 * (spec/36 §5).
 */
export default function TemplateCard({ template, names, onOpen, onEdit, onDelete }) {
  const Icon = templateIcon(template);
  const category = categoryMeta(template.category);
  const integrations = templateIntegrations(template);
  const trigger = TRIGGER_META[template.triggerType || template.trigger?.type] || TRIGGER_META.manual;
  const TriggerIcon = trigger.icon;
  const difficulty = DIFFICULTY[template.difficulty];
  const shown = integrations.slice(0, 6);

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="template-card"
      onClick={() => onOpen(template)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(template); } }}
      className="group flex h-full cursor-pointer flex-col rounded-card border border-default bg-surface p-4 text-left transition-colors hover:border-strong hover:bg-bg-subtle/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', category.tile)}>
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        {(onEdit || onDelete) && (
          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Menu
              label={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
              title="Template actions"
              align="right"
              buttonClassName="inline-flex h-7 w-7 items-center justify-center rounded-control text-subtle opacity-60 transition hover:bg-bg-subtle hover:text-fg group-hover:opacity-100"
              panelClassName="w-44"
            >
              {onEdit && <MenuButton onClick={() => onEdit(template)}><Pencil className="h-4 w-4" /> Edit details</MenuButton>}
              {onEdit && onDelete && <MenuSeparator />}
              {onDelete && <MenuButton danger onClick={() => onDelete(template)}><Trash2 className="h-4 w-4" /> Delete</MenuButton>}
            </Menu>
          </span>
        )}
      </div>

      <h3 className="mt-3 text-sm font-semibold text-fg">{template.name}</h3>
      <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm leading-5 text-muted">
        {template.summary || template.description || 'No description.'}
      </p>

      <div className="mb-3 mt-3 flex min-h-[20px] items-center gap-1">
        {shown.map((id) => (
          <Tooltip key={id} content={names?.get(id) || id}>
            <span><IntegrationLogo id={id} size="sm" /></span>
          </Tooltip>
        ))}
        {integrations.length > shown.length && (
          <span className="ml-1 text-2xs font-medium text-subtle">+{integrations.length - shown.length}</span>
        )}
        {!shown.length && <span className="text-xs text-subtle">No integrations needed</span>}
      </div>

      <div className="mt-auto flex items-center gap-3 border-t border-default pt-3 text-xs text-subtle">
        <span className="flex items-center gap-1.5">
          <TriggerIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {trigger.label}
        </span>
        {template.estimatedSetupMinutes && (
          <span className="flex items-center gap-1.5 tabular-nums">
            <Timer className="h-3.5 w-3.5" aria-hidden="true" />
            ~{template.estimatedSetupMinutes} min
          </span>
        )}
        <span className="ml-auto">
          {difficulty ? <Badge tone={difficulty.tone} size="xs">{difficulty.label}</Badge> : (
            template.createdByName && <span>by {template.createdByName}</span>
          )}
        </span>
      </div>
    </div>
  );
}

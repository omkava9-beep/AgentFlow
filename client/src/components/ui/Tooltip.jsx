import * as RT from '@radix-ui/react-tooltip';

/**
 * Tooltip (Radix): hover/focus, portalled so overflow containers never clip it,
 * collision-aware. Wraps exactly one element. Replaces native `title=` on icon
 * buttons and truncated text. `<TooltipProvider>` is mounted once at the root.
 */
export default function Tooltip({ content, children, side = 'top', align = 'center', delay = 300 }) {
  if (!content) return children;
  return (
    <RT.Root delayDuration={delay}>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="z-[100] max-w-xs animate-fade-in rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium leading-snug text-zinc-50 shadow-popover dark:bg-zinc-100 dark:text-zinc-900"
        >
          {content}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}

export const TooltipProvider = RT.Provider;

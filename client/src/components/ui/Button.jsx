import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cx } from './cx';
import Tooltip from './Tooltip';

const VARIANTS = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm',
  secondary: 'border border-default bg-surface text-fg hover:bg-bg-subtle shadow-sm',
  ghost: 'text-muted hover:bg-bg-subtle hover:text-fg',
  danger: 'bg-danger text-white hover:brightness-95 shadow-sm dark:text-zinc-950',
  'danger-ghost': 'text-danger hover:bg-danger-subtle',
  link: 'text-accent hover:underline underline-offset-2 px-0 h-auto',
};

const SIZES = {
  xs: 'h-6 gap-1 px-2 text-xs',
  sm: 'h-7 gap-1.5 px-2.5 text-xs',
  md: 'h-8 gap-2 px-3 text-sm',
  lg: 'h-9 gap-2 px-4 text-sm',
};

const ICON_SIZES = { xs: 'h-3 w-3', sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-4 w-4' };

/**
 * The one button. `icon` is a lucide component rendered before the label;
 * `loading` swaps it for a spinner and disables the button.
 */
const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight, loading = false, className = '', children, disabled, type = 'button', ...props },
  ref,
) {
  const iconClass = ICON_SIZES[size];
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-control font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant] || VARIANTS.primary,
        variant === 'link' ? 'text-sm' : SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className={cx(iconClass, 'animate-spin')} aria-hidden="true" /> : Icon && <Icon className={iconClass} aria-hidden="true" />}
      {children}
      {IconRight && <IconRight className={iconClass} aria-hidden="true" />}
    </button>
  );
});
export default Button;

/** Square icon-only button. `label` is required: it's the tooltip and the accessible name. */
export const IconButton = forwardRef(function IconButton(
  { icon: Icon, label, variant = 'ghost', size = 'md', active = false, className = '', tooltip = true, children, ...props },
  ref,
) {
  const dims = { xs: 'h-6 w-6', sm: 'h-7 w-7', md: 'h-8 w-8', lg: 'h-9 w-9' }[size];
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center rounded-control transition-colors disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant] || VARIANTS.ghost,
        active && 'bg-accent-subtle text-accent-subtle-fg',
        dims,
        className,
      )}
      {...props}
    >
      {Icon && <Icon className={ICON_SIZES[size]} aria-hidden="true" />}
      {children}
    </button>
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
});

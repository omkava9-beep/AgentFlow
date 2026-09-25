import { forwardRef, useId } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cx } from './cx';

export const controlClass =
  'w-full rounded-control border border-default bg-surface px-2.5 text-sm text-fg shadow-sm transition-colors placeholder:text-subtle ' +
  'hover:border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 ' +
  'disabled:cursor-not-allowed disabled:bg-bg-subtle disabled:text-subtle aria-[invalid=true]:border-danger';

/** Label + control + help/error, wired together with ids for screen readers. */
export function Field({ label, help, error, required, htmlFor, className = '', children, trailing }) {
  return (
    <div className={cx('space-y-1.5', className)}>
      {label && (
        // The label sits directly beside its control (no wrapper) unless there's
        // a trailing slot, so "label → sibling input" lookups keep working.
        trailing ? (
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
              {label}
              {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
            </label>
            {trailing}
          </div>
        ) : (
          <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
            {label}
            {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
          </label>
        )
      )}
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">{error}</p>
      ) : help ? (
        <p className="text-xs text-subtle">{help}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ className = '', size = 'md', invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(controlClass, size === 'sm' ? 'h-7 text-xs' : 'h-8', className)}
      {...props}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ className = '', invalid, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cx(controlClass, 'py-2 leading-relaxed', className)}
      {...props}
    />
  );
});

export const Select = forwardRef(function Select({ className = '', size = 'md', children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cx(controlClass, 'appearance-none pr-8', size === 'sm' ? 'h-7 text-xs' : 'h-8', className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
    </div>
  );
});

export function Checkbox({ label, description, className = '', id, ...props }) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <label htmlFor={inputId} className={cx('group flex cursor-pointer items-start gap-2.5', props.disabled && 'cursor-not-allowed opacity-60', className)}>
      <span className="relative mt-0.5 flex h-4 w-4 shrink-0">
        <input id={inputId} type="checkbox" className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-strong bg-surface transition checked:border-accent checked:bg-accent disabled:cursor-not-allowed" {...props} />
        <Check className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-accent-fg opacity-0 peer-checked:opacity-100" strokeWidth={3} aria-hidden="true" />
      </span>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm text-fg">{label}</span>}
          {description && <span className="block text-xs text-subtle">{description}</span>}
        </span>
      )}
    </label>
  );
}

/** Toggle switch. Controlled: pass `checked` + `onChange(nextBool)`. */
export function Switch({ checked, onChange, label, description, disabled, className = '', id }) {
  const autoId = useId();
  const switchId = id || autoId;
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      {(label || description) && (
        <label htmlFor={switchId} className="min-w-0 cursor-pointer">
          {label && <span className="block text-sm font-medium text-fg">{label}</span>}
          {description && <span className="block text-xs text-subtle">{description}</span>}
        </label>
      )}
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={Boolean(checked)}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={cx(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-700',
        )}
      >
        <span className={cx('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}

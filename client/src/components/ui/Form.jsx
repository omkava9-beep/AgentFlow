import { forwardRef, useId } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import * as RCheckbox from '@radix-ui/react-checkbox';
import * as RSwitch from '@radix-ui/react-switch';
import * as RRadio from '@radix-ui/react-radio-group';
import * as RSlider from '@radix-ui/react-slider';
import { cx } from './cx';
export { default as Select } from './Select';

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


/**
 * Checkbox (Radix). `onCheckedChange(bool)`, or `onChange` with a native-like
 * `{ target: { checked } }` event for code written against <input type=checkbox>.
 */
export function Checkbox({ label, description, checked, defaultChecked, onChange, onCheckedChange, disabled, className = '', id, name, value, 'aria-label': ariaLabel, 'data-testid': testId, indeterminate = false, size = 'md' }) {
  const autoId = useId();
  const boxId = id || autoId;
  const state = indeterminate ? 'indeterminate' : checked;
  const box = (
    <RCheckbox.Root
      id={boxId}
      checked={state}
      defaultChecked={defaultChecked}
      disabled={disabled}
      name={name}
      value={value}
      aria-label={ariaLabel || (typeof label === 'string' ? undefined : ariaLabel)}
      data-testid={testId}
      onCheckedChange={(v) => {
        const next = v === true;
        onCheckedChange?.(next);
        onChange?.({ target: { checked: next, name, value }, currentTarget: { checked: next } });
      }}
      className={cx(
        'peer flex shrink-0 items-center justify-center rounded border border-strong bg-surface shadow-sm transition-colors',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4',
      )}
    >
      <RCheckbox.Indicator className="text-accent-fg">
        {state === 'indeterminate' ? <Minus className="h-3 w-3" strokeWidth={3} /> : <Check className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} strokeWidth={3} />}
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  );
  if (!label && !description) return box;
  return (
    <div className={cx('flex items-start gap-2.5', disabled && 'opacity-60', className)}>
      <span className="mt-0.5 flex">{box}</span>
      <label htmlFor={boxId} className={cx('min-w-0 cursor-pointer', disabled && 'cursor-not-allowed')}>
        {label && <span className="block text-sm text-fg">{label}</span>}
        {description && <span className="block text-xs text-subtle">{description}</span>}
      </label>
    </div>
  );
}

/** Toggle switch (Radix). Controlled: `checked` + `onChange(nextBool)`. */
export function Switch({ checked, onChange, onCheckedChange, label, description, disabled, className = '', id, size = 'md', 'data-testid': testId, 'aria-label': ariaLabel }) {
  const autoId = useId();
  const switchId = id || autoId;
  const control = (
    <RSwitch.Root
      id={switchId}
      checked={Boolean(checked)}
      disabled={disabled}
      data-testid={testId}
      aria-label={ariaLabel}
      onCheckedChange={(v) => { onCheckedChange?.(v); onChange?.(v); }}
      className={cx(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        'bg-zinc-300 data-[state=checked]:bg-accent dark:bg-zinc-700',
        size === 'sm' ? 'h-4 w-7' : 'h-5 w-9',
      )}
    >
      <RSwitch.Thumb className={cx(
        'block rounded-full bg-white shadow transition-transform',
        size === 'sm' ? 'h-3 w-3 translate-x-0.5 data-[state=checked]:translate-x-3.5' : 'h-4 w-4 translate-x-0.5 data-[state=checked]:translate-x-[18px]',
      )}
      />
    </RSwitch.Root>
  );
  if (!label && !description) return control;
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      <label htmlFor={switchId} className="min-w-0 cursor-pointer">
        {label && <span className="block text-sm font-medium text-fg">{label}</span>}
        {description && <span className="block text-xs text-subtle">{description}</span>}
      </label>
      {control}
    </div>
  );
}

/** Radio group (Radix). `options: [{ value, label, description?, disabled? }]`, `value`, `onChange(value)`. */
export function RadioGroup({ options, value, onChange, disabled, orientation = 'vertical', className = '', 'aria-label': ariaLabel }) {
  return (
    <RRadio.Root
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      orientation={orientation}
      aria-label={ariaLabel}
      className={cx(orientation === 'horizontal' ? 'flex flex-wrap gap-4' : 'space-y-2', className)}
    >
      {options.map((o) => {
        const itemId = `rg-${String(o.value)}`;
        return (
          <div key={o.value} className={cx('flex items-start gap-2.5', o.disabled && 'opacity-50')}>
            <RRadio.Item
              id={itemId}
              value={o.value}
              disabled={o.disabled}
              className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-strong bg-surface shadow-sm data-[state=checked]:border-accent"
            >
              <RRadio.Indicator className="h-2 w-2 rounded-full bg-accent" />
            </RRadio.Item>
            <label htmlFor={itemId} className="min-w-0 cursor-pointer">
              <span className="block text-sm text-fg">{o.label}</span>
              {o.description && <span className="block text-xs text-subtle">{o.description}</span>}
            </label>
          </div>
        );
      })}
    </RRadio.Root>
  );
}

/** Slider (Radix). Single value: `value` + `onChange(number)`; `format(v)` renders the readout. */
export function Slider({ value, onChange, onCommit, min = 0, max = 100, step = 1, disabled, format, className = '', 'aria-label': ariaLabel }) {
  return (
    <div className={cx('flex items-center gap-3', className)}>
      <RSlider.Root
        value={[Number(value) || 0]}
        onValueChange={([v]) => onChange?.(v)}
        onValueCommit={([v]) => onCommit?.(v)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel}
        className="relative flex h-5 w-full touch-none select-none items-center data-[disabled]:opacity-50"
      >
        <RSlider.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-bg-subtle ring-1 ring-inset ring-zinc-900/5 dark:ring-white/10">
          <RSlider.Range className="absolute h-full bg-accent" />
        </RSlider.Track>
        <RSlider.Thumb className="block h-4 w-4 rounded-full border border-strong bg-surface shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" />
      </RSlider.Root>
      {format && <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted">{format(Number(value) || 0)}</span>}
    </div>
  );
}

/**
 * Number field with − / + steppers and min/max clamping. `onChange` gets a
 * native-like event (`e.target.value` as a string) so it drops in for
 * <input type="number">; `onValueChange(number | '')` gets the number.
 */
export const NumberInput = forwardRef(function NumberInput(
  { value, onChange, onValueChange, min, max, step = 1, disabled, placeholder, className = '', size = 'md', id, invalid, suffix, 'aria-label': ariaLabel, ...rest },
  ref,
) {
  const num = value === '' || value === null || value === undefined ? '' : Number(value);
  const clamp = (n) => {
    let out = n;
    if (min !== undefined && min !== '' && out < Number(min)) out = Number(min);
    if (max !== undefined && max !== '' && out > Number(max)) out = Number(max);
    return out;
  };
  const emit = (raw) => {
    onValueChange?.(raw === '' ? '' : Number(raw));
    onChange?.({ target: { value: String(raw) }, currentTarget: { value: String(raw) } });
  };
  const bump = (dir) => {
    const base = num === '' || Number.isNaN(num) ? (min !== undefined ? Number(min) : 0) : num;
    const next = clamp(Math.round((base + dir * Number(step)) * 1e6) / 1e6);
    emit(next);
  };
  const h = size === 'sm' ? 'h-7' : 'h-8';
  const stepBtn = 'flex w-7 shrink-0 items-center justify-center text-subtle transition-colors hover:bg-bg-subtle hover:text-fg disabled:opacity-40';
  return (
    <div className={cx('flex items-stretch overflow-hidden rounded-control border border-default bg-surface shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20', invalid && 'border-danger', disabled && 'opacity-60', h, className)}>
      <button type="button" tabIndex={-1} aria-label="Decrease" disabled={disabled || (min !== undefined && num !== '' && num <= Number(min))} onClick={() => bump(-1)} className={cx(stepBtn, 'border-r border-default')}>
        <Minus className="h-3 w-3" aria-hidden="true" />
      </button>
      <input
        ref={ref}
        id={id}
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        value={num === '' || Number.isNaN(num) ? (value ?? '') : value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9.-]/g, '');
          emit(raw);
        }}
        onBlur={() => { if (num !== '' && !Number.isNaN(num) && clamp(num) !== num) emit(clamp(num)); }}
        onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); } else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); } }}
        className="min-w-0 flex-1 bg-transparent px-2 text-center text-sm tabular-nums text-fg outline-none placeholder:text-subtle"
        {...rest}
      />
      {suffix && <span className="flex items-center pr-2 text-xs text-subtle">{suffix}</span>}
      <button type="button" tabIndex={-1} aria-label="Increase" disabled={disabled || (max !== undefined && num !== '' && num >= Number(max))} onClick={() => bump(1)} className={cx(stepBtn, 'border-l border-default')}>
        <Plus className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
});

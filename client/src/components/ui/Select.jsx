import { Children, forwardRef, isValidElement, useMemo } from 'react';
import * as RS from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cx } from './cx';
import { menuContentClass, menuItemClass, menuLabelClass, menuSeparatorClass } from './menuStyles';

// Radix rejects '' as an item value; the empty option ("None", "Select…") maps
// to this sentinel internally and back to '' for callers.
const EMPTY = '__af_empty__';
const toRadix = (v) => (v === '' || v === null || v === undefined ? EMPTY : String(v));
const fromRadix = (v) => (v === EMPTY ? '' : v);

function textOf(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf(node.props.children);
  return '';
}

/**
 * Reads legacy `<option>` / `<optgroup>` children into option data, so every
 * `<Select><option …/></Select>` in the app renders as the Radix select
 * without its caller changing.
 */
function optionsFromChildren(children) {
  const groups = [];
  let loose = { label: null, options: [] };
  groups.push(loose);
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'optgroup') {
      const g = { label: child.props.label, options: [] };
      Children.forEach(child.props.children, (opt) => {
        if (isValidElement(opt) && opt.type === 'option') {
          g.options.push({ value: opt.props.value ?? textOf(opt.props.children), label: textOf(opt.props.children), disabled: opt.props.disabled });
        }
      });
      groups.push(g);
      loose = { label: null, options: [] };
      groups.push(loose);
    } else if (child.type === 'option') {
      loose.options.push({ value: child.props.value ?? textOf(child.props.children), label: textOf(child.props.children), disabled: child.props.disabled });
    }
  });
  return groups.filter((g) => g.options.length);
}

/**
 * The select. Pass either `options` — `[{ value, label, description?, icon?,
 * disabled? }]` or grouped `[{ label, options: [...] }]` — or legacy `<option>`
 * children. `onChange` receives `{ target: { value } }` (like a native change
 * event) and `onValueChange(value)` receives the value directly.
 */
const Select = forwardRef(function Select(
  {
    value, defaultValue, onChange, onValueChange, options, children, placeholder = 'Select…', disabled, size = 'md',
    className = '', contentClassName = '', id, name, required, invalid, 'aria-label': ariaLabel, 'data-testid': testId, align = 'start',
  },
  ref,
) {
  const groups = useMemo(() => {
    if (options) {
      const grouped = options.some((o) => Array.isArray(o.options));
      return grouped ? options : [{ label: null, options }];
    }
    return optionsFromChildren(children);
  }, [options, children]);

  const all = groups.flatMap((g) => g.options);
  const current = all.find((o) => toRadix(o.value) === toRadix(value));
  const emptyOption = all.find((o) => toRadix(o.value) === EMPTY);

  function handle(v) {
    const out = fromRadix(v);
    onValueChange?.(out);
    onChange?.({ target: { value: out, name }, currentTarget: { value: out, name } });
  }

  return (
    <RS.Root
      value={value === undefined ? undefined : toRadix(value)}
      defaultValue={defaultValue === undefined ? undefined : toRadix(defaultValue)}
      onValueChange={handle}
      disabled={disabled}
      name={name}
      required={required}
    >
      <RS.Trigger
        ref={ref}
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        data-testid={testId}
        data-value={value === undefined ? undefined : String(value ?? '')}
        className={cx(
          'flex w-full items-center justify-between gap-2 rounded-control border border-default bg-surface px-2.5 text-left text-sm text-fg shadow-sm transition-colors',
          'hover:border-strong focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 data-[state=open]:border-accent',
          'disabled:cursor-not-allowed disabled:bg-bg-subtle disabled:text-subtle aria-[invalid=true]:border-danger',
          size === 'sm' ? 'h-7 text-xs' : 'h-8',
          className,
        )}
      >
        <span className={cx('flex min-w-0 items-center gap-2 truncate', !current && !emptyOption && 'text-subtle')}>
          {current?.icon && <current.icon className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />}
          <RS.Value placeholder={placeholder}>{current ? current.label : (emptyOption?.label || placeholder)}</RS.Value>
        </span>
        <RS.Icon asChild><ChevronDown className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" /></RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content
          position="popper"
          sideOffset={4}
          align={align}
          collisionPadding={8}
          className={cx(menuContentClass, 'max-h-[min(var(--radix-select-content-available-height),360px)] min-w-[var(--radix-select-trigger-width)]', contentClassName)}
        >
          <RS.ScrollUpButton className="flex h-5 items-center justify-center text-subtle"><ChevronUp className="h-3.5 w-3.5" /></RS.ScrollUpButton>
          <RS.Viewport>
            {groups.map((g, gi) => (
              <RS.Group key={`${g.label || 'g'}-${gi}`}>
                {gi > 0 && <RS.Separator className={menuSeparatorClass} />}
                {g.label && <RS.Label className={menuLabelClass}>{g.label}</RS.Label>}
                {g.options.map((o) => (
                  <RS.Item
                    key={toRadix(o.value)}
                    value={toRadix(o.value)}
                    data-value={String(o.value ?? '')}
                    disabled={o.disabled}
                    className={cx(menuItemClass, 'pr-8', o.description && 'items-start')}
                  >
                    {o.icon && <o.icon aria-hidden="true" />}
                    <span className="min-w-0 flex-1">
                      <RS.ItemText>{o.label}</RS.ItemText>
                      {o.description && <span className="block text-xs text-subtle">{o.description}</span>}
                    </span>
                    <RS.ItemIndicator className="absolute right-2 top-1/2 -translate-y-1/2">
                      <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    </RS.ItemIndicator>
                  </RS.Item>
                ))}
              </RS.Group>
            ))}
          </RS.Viewport>
          <RS.ScrollDownButton className="flex h-5 items-center justify-center text-subtle"><ChevronDown className="h-3.5 w-3.5" /></RS.ScrollDownButton>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
});

export default Select;

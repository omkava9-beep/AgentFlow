import { NavLink } from 'react-router-dom';
import { useRef } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { cx } from './cx';

/**
 * Underline tabs. Either controlled (`value` + `onChange`) with items
 * `{ value, label, icon?, count? }`, or route-driven with items `{ to, label }`
 * (NavLink decides the active one). Arrow keys move between controlled tabs.
 */
export default function Tabs({ items, value, onChange, className = '', size = 'md' }) {
  const ref = useRef(null);
  const pad = size === 'sm' ? 'pb-2 text-xs' : 'pb-2.5 text-sm';

  function onKeyDown(e) {
    if (!onChange || !['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const idx = items.findIndex((i) => i.value === value);
    const next = items[(idx + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
    onChange(next.value);
    ref.current?.querySelector(`[data-tab="${next.value}"]`)?.focus();
  }

  const tabClass = (active) =>
    cx(
      'relative -mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 font-medium transition-colors',
      pad,
      active ? 'border-accent text-fg' : 'border-transparent text-subtle hover:text-fg',
    );

  return (
    <div ref={ref} role="tablist" onKeyDown={onKeyDown} className={cx('flex gap-5 overflow-x-auto border-b border-default', className)}>
      {items.map((item) => {
        const Icon = item.icon;
        const inner = (
          <>
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            {item.label}
            {item.count != null && (
              <span className="rounded-full bg-bg-subtle px-1.5 text-2xs font-semibold tabular-nums text-muted">{item.count}</span>
            )}
          </>
        );
        if (item.to) {
          return (
            <NavLink key={item.to} to={item.to} end={item.end} role="tab" className={({ isActive }) => tabClass(isActive)}>
              {inner}
            </NavLink>
          );
        }
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            data-tab={item.value}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange?.(item.value)}
            className={tabClass(active)}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}

/** Compact segmented control for 2-4 options (filters, view toggles), on Radix ToggleGroup. */
export function Segmented({ items, value, onChange, size = 'sm', className = '', 'aria-label': ariaLabel }) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => { if (v) onChange(v); }}
      aria-label={ariaLabel}
      className={cx('inline-flex rounded-control border border-default bg-bg-subtle p-0.5', className)}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <ToggleGroup.Item
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-[5px] font-medium text-subtle transition-colors hover:text-fg disabled:opacity-50',
              'data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-sm',
              size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-sm',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            {item.label}
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}

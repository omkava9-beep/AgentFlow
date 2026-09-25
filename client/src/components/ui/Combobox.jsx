import { useEffect, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Loader2, Plus, Search, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { cx } from './cx';

const itemClass = 'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg outline-none data-[disabled=true]:opacity-45 data-[selected=true]:bg-bg-subtle';
const triggerClass =
  'flex w-full min-h-8 items-center justify-between gap-2 rounded-control border border-default bg-surface px-2.5 py-1 text-left text-sm text-fg shadow-sm transition-colors ' +
  'hover:border-strong focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 data-[state=open]:border-accent disabled:cursor-not-allowed disabled:bg-bg-subtle disabled:text-subtle';

function normalize(options) {
  const grouped = options?.some((o) => Array.isArray(o.options));
  return grouped ? options : [{ label: null, options: options || [] }];
}

/**
 * The searchable picker (cmdk in a Popover) for long lists: integrations,
 * workflows, members, connections, models, timezones.
 *
 * - `options`: `[{ value, label, description?, icon?, disabled?, keywords? }]`
 *   or grouped `[{ label, options: [...] }]`
 * - `multiple`: `value` is an array; picking toggles
 * - `onSearch(query)`: async options loader (debounced); results replace `options`
 * - `onCreate(query)`: shows a "Create “query”" row
 * - `onChange(value)` gets the value (string, or string[] when `multiple`)
 */
export function Combobox({
  options = [], value, onChange, multiple = false, placeholder = 'Select…', searchPlaceholder = 'Search…',
  emptyText = 'No results.', onSearch, onCreate, createLabel = (q) => `Create “${q}”`, disabled,
  className = '', contentClassName = '', renderValue, size = 'md', 'aria-label': ariaLabel, 'data-testid': testId, clearable = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!onSearch || !open) return undefined;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await onSearch(query);
        if (!cancelled) setRemote(res);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open, onSearch]);

  const groups = useMemo(() => normalize(remote || options), [remote, options]);
  const all = groups.flatMap((g) => g.options);
  const selected = multiple ? (Array.isArray(value) ? value : []) : value;
  const isSelected = (v) => (multiple ? selected.includes(v) : selected === v);
  const current = multiple ? all.filter((o) => selected.includes(o.value)) : all.find((o) => o.value === value);

  function pick(v) {
    if (multiple) {
      onChange?.(isSelected(v) ? selected.filter((x) => x !== v) : [...selected, v]);
    } else {
      onChange?.(v);
      setOpen(false);
    }
  }

  const display = renderValue ? renderValue(current) : multiple ? (
    current.length ? (
      <span className="flex min-w-0 flex-wrap gap-1">
        {current.map((o) => (
          <span key={o.value} className="inline-flex items-center gap-1 rounded bg-bg-subtle px-1.5 py-0.5 text-xs text-fg ring-1 ring-inset ring-zinc-900/5 dark:ring-white/10">
            {o.icon && <o.icon className="h-3 w-3 text-subtle" aria-hidden="true" />}
            {o.label}
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Remove ${o.label}`}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); pick(o.value); }}
              className="text-subtle hover:text-fg"
            >
              <X className="h-3 w-3" />
            </span>
          </span>
        ))}
      </span>
    ) : <span className="text-subtle">{placeholder}</span>
  ) : current ? (
    <span className="flex min-w-0 items-center gap-2 truncate">{current.icon && <current.icon className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />}<span className="truncate">{current.label}</span></span>
  ) : <span className="truncate text-subtle">{placeholder}</span>;

  const trimmed = query.trim();
  const canCreate = onCreate && trimmed && !all.some((o) => String(o.label).toLowerCase() === trimmed.toLowerCase());

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} aria-label={ariaLabel} data-testid={testId} className={cx(triggerClass, size === 'sm' && 'min-h-7 text-xs', className)}>
          <span className="min-w-0 flex-1">{display}</span>
          {clearable && !multiple && value ? (
            <span role="button" tabIndex={-1} aria-label="Clear" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange?.(null); }} className="text-subtle hover:text-fg"><X className="h-3.5 w-3.5" /></span>
          ) : <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />}
        </button>
      </PopoverTrigger>
      <PopoverContent padded={false} className={cx('w-[var(--radix-popover-trigger-width)] min-w-[240px] overflow-hidden', contentClassName)}>
        <Command shouldFilter={!onSearch} loop>
          <div className="flex items-center gap-2 border-b border-default px-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />
            <Command.Input value={query} onValueChange={setQuery} placeholder={searchPlaceholder} className="h-9 w-full bg-transparent text-sm text-fg outline-none placeholder:text-subtle" />
            {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-subtle" aria-hidden="true" />}
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-1">
            {!canCreate && <Command.Empty className="px-2 py-5 text-center text-xs text-subtle">{loading ? 'Searching…' : emptyText}</Command.Empty>}
            {groups.map((g, gi) => (
              <Command.Group
                key={`${g.label || 'g'}-${gi}`}
                heading={g.label || undefined}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle"
              >
                {g.options.map((o) => (
                  <Command.Item
                    key={String(o.value)}
                    value={`${o.label} ${o.keywords || ''} ${o.value}`}
                    disabled={o.disabled}
                    onSelect={() => pick(o.value)}
                    className={cx(itemClass, o.description && 'items-start')}
                  >
                    {multiple ? (
                      <span className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border', isSelected(o.value) ? 'border-accent bg-accent text-accent-fg' : 'border-strong')}>
                        {isSelected(o.value) && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                    ) : null}
                    {o.icon && <o.icon className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.description && <span className="block truncate text-xs text-subtle">{o.description}</span>}
                    </span>
                    {!multiple && isSelected(o.value) && <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
            {canCreate && (
              <Command.Item value={`__create__ ${trimmed}`} onSelect={() => { onCreate(trimmed); setQuery(''); if (!multiple) setOpen(false); }} className={itemClass}>
                <Plus className="h-4 w-4 text-subtle" aria-hidden="true" /> {createLabel(trimmed)}
              </Command.Item>
            )}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Multi-select with chips — `Combobox multiple`. */
export function MultiSelect(props) {
  return <Combobox multiple {...props} />;
}

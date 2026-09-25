import { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { format, parseISO, isValid } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { cx } from './cx';

// Values are 'yyyy-MM-dd' strings, the same shape <input type="date"> produced,
// so filters and query strings keep working.
const toDate = (s) => { if (!s) return undefined; const d = parseISO(s); return isValid(d) ? d : undefined; };
const toStr = (d) => (d ? format(d, 'yyyy-MM-dd') : '');

const triggerClass =
  'flex h-8 w-full items-center gap-2 rounded-control border border-default bg-surface px-2.5 text-left text-sm text-fg shadow-sm transition-colors ' +
  'hover:border-strong focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 data-[state=open]:border-accent';

// react-day-picker, styled with the tokens (no library stylesheet).
const dayPickerClassNames = {
  root: 'p-3 text-sm text-fg',
  months: 'flex gap-4',
  month: 'space-y-2',
  month_caption: 'flex h-7 items-center justify-center text-sm font-semibold',
  nav: 'absolute right-3 top-3 flex items-center gap-1',
  button_previous: 'inline-flex h-7 w-7 items-center justify-center rounded-control text-muted hover:bg-bg-subtle hover:text-fg',
  button_next: 'inline-flex h-7 w-7 items-center justify-center rounded-control text-muted hover:bg-bg-subtle hover:text-fg',
  month_grid: 'border-collapse',
  weekdays: 'flex',
  weekday: 'w-8 text-center text-2xs font-medium uppercase text-subtle',
  week: 'mt-1 flex',
  day: 'h-8 w-8 p-0 text-center',
  day_button: 'h-8 w-8 rounded-md text-sm tabular-nums transition-colors hover:bg-bg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
  today: 'font-semibold text-accent',
  selected: '[&>button]:bg-accent [&>button]:text-accent-fg [&>button]:hover:bg-accent',
  range_middle: '[&>button]:!bg-accent-subtle [&>button]:!text-accent-subtle-fg [&>button]:rounded-none',
  range_start: '[&>button]:rounded-r-none',
  range_end: '[&>button]:rounded-l-none',
  outside: 'text-subtle opacity-50',
  disabled: 'opacity-40',
  hidden: 'invisible',
};

const components = {
  Chevron: ({ orientation }) => (orientation === 'left' ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />),
};

/** A single date. `value` / `onChange` use 'yyyy-MM-dd' strings ('' when cleared). */
export function DatePicker({ value, onChange, placeholder = 'Pick a date', disabled, className = '', clearable = true, 'aria-label': ariaLabel, fromDate, toDate: toDateLimit }) {
  const [open, setOpen] = useState(false);
  const selected = toDate(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} aria-label={ariaLabel} className={cx(triggerClass, className)}>
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />
          <span className={cx('min-w-0 flex-1 truncate', !selected && 'text-subtle')}>{selected ? format(selected, 'd MMM yyyy') : placeholder}</span>
          {clearable && selected && (
            <span role="button" tabIndex={-1} aria-label="Clear date" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange?.(''); }} className="text-subtle hover:text-fg"><X className="h-3.5 w-3.5" /></span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent padded={false} className="relative">
        <DayPicker
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => { onChange?.(toStr(d)); setOpen(false); }}
          classNames={dayPickerClassNames}
          components={components}
          disabled={[fromDate && { before: toDate(fromDate) }, toDateLimit && { after: toDate(toDateLimit) }].filter(Boolean)}
          showOutsideDays
        />
      </PopoverContent>
    </Popover>
  );
}

const PRESETS = [
  { label: 'Last 24 hours', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

/** A date range. `value = { from, to }` ('yyyy-MM-dd' strings), `onChange({ from, to })`. */
export function DateRangePicker({ value = {}, onChange, placeholder = 'Any time', disabled, className = '', 'aria-label': ariaLabel }) {
  const [open, setOpen] = useState(false);
  const range = { from: toDate(value.from), to: toDate(value.to) };
  const label = range.from
    ? `${format(range.from, 'd MMM')}${range.to ? ` – ${format(range.to, 'd MMM yyyy')}` : ' – …'}`
    : placeholder;
  function preset(days) {
    const to = new Date();
    const from = new Date(Date.now() - (days - 1) * 86400000);
    onChange?.({ from: toStr(from), to: toStr(to) });
    setOpen(false);
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} aria-label={ariaLabel} className={cx(triggerClass, className)}>
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />
          <span className={cx('min-w-0 flex-1 truncate', !range.from && 'text-subtle')}>{label}</span>
          {range.from && (
            <span role="button" tabIndex={-1} aria-label="Clear range" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange?.({ from: '', to: '' }); }} className="text-subtle hover:text-fg"><X className="h-3.5 w-3.5" /></span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent padded={false} className="relative flex">
        <div className="flex w-36 flex-col gap-0.5 border-r border-default p-2">
          {PRESETS.map((p) => (
            <button key={p.days} type="button" onClick={() => preset(p.days)} className="rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-bg-subtle">{p.label}</button>
          ))}
        </div>
        <DayPicker
          mode="range"
          selected={range.from ? range : undefined}
          defaultMonth={range.from}
          numberOfMonths={2}
          onSelect={(r) => onChange?.({ from: toStr(r?.from), to: toStr(r?.to) })}
          classNames={dayPickerClassNames}
          components={components}
          showOutsideDays
        />
      </PopoverContent>
    </Popover>
  );
}

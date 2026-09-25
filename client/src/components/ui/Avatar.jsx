import { cx } from './cx';
import Tooltip from './Tooltip';
import { initialsOf } from './initials';

// Deterministic, muted hues so each person keeps one colour across the app.
const HUES = ['bg-indigo-500', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-500', 'bg-sky-600', 'bg-violet-500', 'bg-teal-600', 'bg-orange-500'];

function hueFor(seed = '') {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

const SIZES = { xs: 'h-5 w-5 text-[9px]', sm: 'h-6 w-6 text-2xs', md: 'h-8 w-8 text-xs', lg: 'h-10 w-10 text-sm' };

export default function Avatar({ name, email, seed, size = 'md', color, className = '', ring = false, title }) {
  const label = name || email || '?';
  return (
    <span
      title={title}
      aria-label={label}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        SIZES[size],
        !color && hueFor(seed || email || name),
        ring && 'ring-2 ring-surface',
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
    >
      {initialsOf(label)}
    </span>
  );
}

/** Overlapping avatars with a +N overflow chip. `people`: [{ id, name, email, color? }]. */
export function AvatarStack({ people = [], max = 4, size = 'sm' }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((p) => (
        <Tooltip key={p.id || p.email || p.name} content={p.name || p.email}>
          <span><Avatar name={p.name} email={p.email} seed={p.id} color={p.color} size={size} ring /></span>
        </Tooltip>
      ))}
      {extra > 0 && (
        <span className={cx('inline-flex items-center justify-center rounded-full bg-bg-subtle font-medium text-muted ring-2 ring-surface', SIZES[size])}>
          +{extra}
        </span>
      )}
    </div>
  );
}

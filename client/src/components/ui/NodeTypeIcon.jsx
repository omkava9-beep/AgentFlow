import { cx } from './cx';
import { nodeTypeMeta } from './nodeTypes';

/** `tile` wraps the icon in its tinted square; otherwise just the tinted glyph. */
export default function NodeTypeIcon({ type, size = 'md', tile = true, className = '' }) {
  const meta = nodeTypeMeta(type);
  const Icon = meta.icon;
  const dims = { xs: ['h-4 w-4 rounded', 'h-2.5 w-2.5'], sm: ['h-5 w-5 rounded', 'h-3 w-3'], md: ['h-7 w-7 rounded-md', 'h-4 w-4'], lg: ['h-8 w-8 rounded-md', 'h-4 w-4'] }[size];
  if (!tile) return <Icon className={cx(dims[1], meta.tint.split(' ').filter((c) => c.startsWith('text-') || c.startsWith('dark:text-')).join(' '), className)} aria-hidden="true" />;
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center', dims[0], meta.tint, className)} aria-hidden="true">
      <Icon className={dims[1]} strokeWidth={2.25} />
    </span>
  );
}

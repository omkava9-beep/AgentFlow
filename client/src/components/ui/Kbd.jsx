import { cx } from './cx';

export default function Kbd({ children, className = '' }) {
  return (
    <kbd className={cx('inline-flex h-5 min-w-5 items-center justify-center rounded border border-default bg-surface px-1 font-mono text-2xs font-medium text-subtle', className)}>
      {children}
    </kbd>
  );
}

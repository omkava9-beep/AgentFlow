/**
 * Loading placeholders (spec/36 §6): every list or table page shows one of
 * these instead of bare "Loading..." text, so a page's shape is visible before
 * its data arrives.
 */
export function Skeleton({ className = 'h-4 w-full' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-bg-subtle dark:bg-zinc-800/70 ${className}`} />;
}

export function SkeletonCard({ lines = 2 }) {
  return (
    <div className="rounded-card border border-default bg-surface p-4">
      <Skeleton className="mb-3 h-4 w-2/5" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`mb-2 h-3 ${i === lines - 1 ? 'w-3/5' : 'w-full'}`} />
      ))}
    </div>
  );
}

/** A grid of card placeholders, for card-grid pages. */
export function SkeletonGrid({ count = 6, className = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3' }) {
  return (
    <div role="status" aria-label="Loading" className={className}>
      {Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

export function SkeletonTable({ rows = 5, columns = 4 }) {
  return (
    <div role="status" aria-label="Loading" className="overflow-hidden rounded-card border border-default bg-surface">
      <div className="flex gap-4 border-b border-default bg-bg-subtle/60 px-4 py-2.5">
        {Array.from({ length: columns }, (_, c) => <Skeleton key={c} className={`h-2.5 ${c === 0 ? 'w-1/4' : 'flex-1'}`} />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-b border-default px-4 py-3 last:border-0">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={`h-3 ${c === 0 ? 'w-1/3' : 'flex-1'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

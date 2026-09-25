import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cx } from './cx';
import { Skeleton } from './Skeleton';
import EmptyState from './EmptyState';

/**
 * The list/table primitive. Columns: `{ key, header, cell?(row), sortable?,
 * sortValue?(row), align?: 'left'|'right'|'center', width?, className? }`.
 * Sorting is client-side over the rows passed in; server-paginated pages
 * leave `sortable` off. `onRowClick` makes rows clickable (and keyboard-
 * activatable with Enter).
 */
export default function DataTable({
  columns, rows, rowKey = (r) => r.id || r._id, onRowClick, loading = false, loadingRows = 6,
  empty, dense = false, stickyHeader = true, initialSort = null, className = '', rowClassName, footer,
}) {
  const [sort, setSort] = useState(initialSort); // { key, dir: 'asc'|'desc' }

  const sorted = useMemo(() => {
    if (!sort || !rows) return rows || [];
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const value = col.sortValue || ((r) => r[col.key]);
    const out = [...rows].sort((a, b) => {
      const va = value(a); const vb = value(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va > vb ? 1 : va < vb ? -1 : 0;
    });
    return sort.dir === 'desc' ? out.reverse() : out;
  }, [rows, sort, columns]);

  function toggleSort(col) {
    if (!col.sortable) return;
    setSort((s) => (s?.key === col.key ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: 'asc' }));
  }

  const cellPad = dense ? 'px-3 py-2' : 'px-4 py-3';
  const alignClass = (a) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

  if (!loading && rows && rows.length === 0 && empty) {
    return typeof empty === 'object' && !empty.$$typeof ? <EmptyState {...empty} /> : empty;
  }

  return (
    <div className={cx('overflow-hidden rounded-card border border-default bg-surface', className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className={cx(stickyHeader && 'sticky top-0 z-[1]')}>
            <tr className="border-b border-default bg-bg-subtle/70 backdrop-blur">
              {columns.map((col) => {
                const active = sort?.key === col.key;
                const SortIcon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    style={col.width ? { width: col.width } : undefined}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cx(dense ? 'px-3 py-2' : 'px-4 py-2.5', 'whitespace-nowrap text-xs font-medium text-subtle', alignClass(col.align))}
                  >
                    {col.sortable ? (
                      <button type="button" onClick={() => toggleSort(col)} className={cx('inline-flex items-center gap-1 hover:text-fg', active && 'text-fg')}>
                        {col.header}
                        <SortIcon className="h-3 w-3" aria-hidden="true" />
                      </button>
                    ) : col.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: loadingRows }, (_, i) => (
                <tr key={`sk-${i}`} className="border-b border-default last:border-0">
                  {columns.map((c, ci) => (
                    <td key={c.key} className={cellPad}><Skeleton className={cx('h-3', ci === 0 ? 'w-2/3' : 'w-1/2')} /></td>
                  ))}
                </tr>
              ))
              : sorted.map((row, i) => (
                <tr
                  key={rowKey(row) ?? i}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={cx(
                    'border-b border-default transition-colors last:border-0',
                    onRowClick && 'cursor-pointer hover:bg-bg-subtle/60 focus:bg-bg-subtle/60 focus:outline-none',
                    typeof rowClassName === 'function' ? rowClassName(row) : rowClassName,
                  )}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cx(cellPad, 'align-middle text-fg', alignClass(col.align), col.className)}>
                      {col.cell ? col.cell(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {footer && <div className="border-t border-default px-4 py-2.5">{footer}</div>}
    </div>
  );
}

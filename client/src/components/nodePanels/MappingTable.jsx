/**
 * Key → template rows, shared by Transform's mappings and Sub-workflow's
 * input mapping (spec/31 §1, §6). Keys may be dotted paths.
 */
export default function MappingTable({ rows = [], onChange, keyPlaceholder = 'field', valuePlaceholder = '{{input.field}}' }) {
  const update = (index, patch) => onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const remove = (index) => onChange(rows.filter((_, i) => i !== index));
  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const input = 'w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1">
          <input className={input} value={row.key || ''} placeholder={keyPlaceholder} onChange={(e) => update(i, { key: e.target.value })} aria-label="Key" />
          <span className="text-xs text-slate-400">=</span>
          <input className={input} value={row.value || ''} placeholder={valuePlaceholder} onChange={(e) => update(i, { value: e.target.value })} aria-label="Value" />
          <button type="button" onClick={() => move(i, -1)} className="px-0.5 text-xs text-slate-400 hover:text-slate-600" title="Move up">↑</button>
          <button type="button" onClick={() => move(i, 1)} className="px-0.5 text-xs text-slate-400 hover:text-slate-600" title="Move down">↓</button>
          <button type="button" onClick={() => remove(i)} className="px-0.5 text-xs text-red-400 hover:text-red-600" title="Remove">✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { key: '', value: '' }])} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
        + Add mapping
      </button>
    </div>
  );
}

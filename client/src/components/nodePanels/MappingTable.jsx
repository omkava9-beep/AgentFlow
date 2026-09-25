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
  const input = 'w-full min-w-0 rounded border border-default bg-surface px-2 py-1 font-mono text-xs   ';

  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1">
          <input className={input} value={row.key || ''} placeholder={keyPlaceholder} onChange={(e) => update(i, { key: e.target.value })} aria-label="Key" />
          <span className="text-xs text-subtle">=</span>
          <input className={input} value={row.value || ''} placeholder={valuePlaceholder} onChange={(e) => update(i, { value: e.target.value })} aria-label="Value" />
          <button type="button" onClick={() => move(i, -1)} className="px-0.5 text-xs text-subtle hover:text-muted" title="Move up">↑</button>
          <button type="button" onClick={() => move(i, 1)} className="px-0.5 text-xs text-subtle hover:text-muted" title="Move down">↓</button>
          <button type="button" onClick={() => remove(i)} className="px-0.5 text-xs text-danger hover:text-danger" title="Remove">✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { key: '', value: '' }])} className="text-xs font-medium text-accent hover:underline">
        + Add mapping
      </button>
    </div>
  );
}

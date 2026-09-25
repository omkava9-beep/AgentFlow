import { Tooltip } from '../ui/index';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
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
          <Tooltip content={"Move up"}>
            <button aria-label={"Move up"} type="button" onClick={() => move(i, -1)} className="rounded p-0.5 text-subtle hover:bg-bg-subtle hover:text-fg"><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </Tooltip>
          <Tooltip content={"Move down"}>
            <button aria-label={"Move down"} type="button" onClick={() => move(i, 1)} className="rounded p-0.5 text-subtle hover:bg-bg-subtle hover:text-fg"><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </Tooltip>
          <Tooltip content={"Remove"}>
            <button aria-label={"Remove"} type="button" onClick={() => remove(i)} className="rounded p-0.5 text-subtle hover:bg-danger-subtle hover:text-danger"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </Tooltip>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { key: '', value: '' }])} className="text-xs font-medium text-accent hover:underline">
        + Add mapping
      </button>
    </div>
  );
}

import { Select } from '../ui';
import MappingTable from './MappingTable';

export default function TransformPanel({ config, set }) {
  return (
    <>
      <Select label="Mode" value={config.mode || 'replace'} onChange={(e) => set({ mode: e.target.value })}>
        <option value="replace">Replace — output only the mapped keys</option>
        <option value="merge">Merge — mapped keys over the input</option>
      </Select>
      <div>
        <span className="mb-1 block text-sm font-medium text-fg">Mappings</span>
        <MappingTable rows={config.mappings || []} onChange={(mappings) => set({ mappings })} keyPlaceholder="customer.name" />
      </div>
      <p className="text-xs text-subtle">
        Templates can use <code>input</code>, <code>run</code> and <code>now</code>. A value that is exactly one
        placeholder, like <code>{'{{input.items}}'}</code>, keeps its type — arrays stay arrays.
      </p>
    </>
  );
}

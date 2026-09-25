import { Select } from '../ui';

export default function WorkflowPicker({ label, value, onChange, workflows, excludeId }) {
  return (
    <Select label={label} value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{workflows ? 'Select a workflow…' : 'Loading…'}</option>
      {(workflows || []).map((w) => (
        <option key={w._id} value={w._id}>
          {w.name}{w._id === excludeId ? ' (this workflow — recursion)' : ''}
        </option>
      ))}
    </Select>
  );
}

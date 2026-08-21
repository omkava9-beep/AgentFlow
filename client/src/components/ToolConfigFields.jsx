import { TextField, TextArea, Select } from './ui';

/**
 * Renders a tool's own settings from the `configSchema` the server publishes
 * (spec/21) — no per-tool branching here, so adding an eighth tool is a registry
 * entry on the backend and nothing at all on the frontend.
 */
export default function ToolConfigFields({ schema = [], values = {}, onChange }) {
  if (!schema.length) return null;

  const set = (key, value) => onChange({ ...values, [key]: value });
  const valueOf = (field) => (values[field.key] !== undefined ? values[field.key] : field.default ?? '');

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tool settings</p>

      {schema.map((field) => {
        const label = field.required ? `${field.label} *` : field.label;

        if (field.type === 'textarea') {
          return (
            <TextArea
              key={field.key}
              label={label}
              rows={3}
              value={valueOf(field)}
              placeholder={field.placeholder}
              onChange={(e) => set(field.key, e.target.value)}
            />
          );
        }

        if (field.type === 'select') {
          return (
            <Select key={field.key} label={label} value={valueOf(field)} onChange={(e) => set(field.key, e.target.value)}>
              {(field.options || []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label ?? option.value}
                </option>
              ))}
            </Select>
          );
        }

        if (field.type === 'boolean') {
          return (
            <label key={field.key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={Boolean(values[field.key] ?? field.default)}
                onChange={(e) => set(field.key, e.target.checked)}
                className="accent-brand-500"
              />
              {label}
            </label>
          );
        }

        return (
          <TextField
            key={field.key}
            label={label}
            type={field.type === 'number' ? 'number' : 'text'}
            value={valueOf(field)}
            placeholder={field.placeholder}
            onChange={(e) => set(field.key, field.type === 'number' ? e.target.value : e.target.value)}
          />
        );
      })}

      <p className="text-xs text-slate-400">
        Text fields support <code>{'{{input.field}}'}</code> placeholders from the upstream node.
      </p>
    </div>
  );
}

import { TextField, TextArea, Select } from './ui';
import { Switch } from './ui/Form';
import { jsonParamError } from '../utils/integrationCatalog';
import { jsonFieldError } from '../utils/mcpSchema';

/**
 * Renders fields from a `configSchema` the server publishes (spec/21, spec/26) —
 * an action's params, or an integration's auth fields in the connection form
 * (spec/25). No per-integration branching here, so adding an integration is a
 * manifest on the backend and nothing on the frontend.
 *
 * Secret fields (`secret: true`) render as password inputs that start empty.
 * With a stored `hints[key]` they read "•••• 1a2b — leave blank to keep", and
 * `onClear` offers an explicit clear (the value becomes `null`, which a PATCH
 * treats as "delete the stored secret").
 */
export default function ToolConfigFields({
  schema = [],
  values = {},
  onChange,
  title = 'Parameters',
  hints = {},
  onClear,
  showTemplateNote = true,
}) {
  if (!schema.length) return null;

  const set = (key, value) => onChange({ ...values, [key]: value });
  const valueOf = (field) => {
    if (field.secret) return values[field.key] ?? '';
    return values[field.key] !== undefined && values[field.key] !== null ? values[field.key] : field.default ?? '';
  };

  return (
    <div className="space-y-3 rounded-lg border border-default p-3">
      {title && <p className="text-xs font-semibold uppercase tracking-wide text-subtle">{title}</p>}

      {schema.map((field) => {
        const label = field.required ? `${field.label} *` : field.label;
        const help = field.description ? <p className="mt-1 text-xs text-subtle">{field.description}</p> : null;

        if (field.secret) {
          const hint = hints[field.key];
          const cleared = values[field.key] === null;
          return (
            <div key={field.key}>
              <TextField
                label={label}
                type="password"
                autoComplete="new-password"
                value={cleared ? '' : valueOf(field)}
                disabled={cleared}
                placeholder={
                  cleared ? 'Will be cleared on save' : hint ? `${hint} — leave blank to keep` : field.placeholder
                }
                onChange={(e) => set(field.key, e.target.value)}
              />
              {hint && onClear && (
                <button
                  type="button"
                  onClick={() => (cleared ? set(field.key, '') : onClear(field.key))}
                  className="mt-1 text-xs text-accent hover:underline"
                >
                  {cleared ? 'Keep the stored value' : 'Clear stored value'}
                </button>
              )}
              {help}
            </div>
          );
        }

        if (field.type === 'textarea' || field.type === 'json') {
          const raw = valueOf(field);
          // A JSON param may already be stored as a value (e.g. from a template).
          const shown = field.type === 'json' && raw !== '' && typeof raw !== 'string' ? JSON.stringify(raw, null, 2) : raw;
          // MCP tools (spec/37) carry the property's sub-schema, so the editor
          // can say *why* a value won't be accepted, not just that it's invalid JSON.
          const error = field.type === 'json' ? (field.schema ? jsonFieldError(shown, field.schema) : jsonParamError(shown)) : null;
          return (
            <div key={field.key}>
              <TextArea
                label={field.type === 'json' ? `${label} (JSON)` : label}
                rows={field.type === 'json' ? 4 : 3}
                value={shown}
                placeholder={field.placeholder}
                className={field.type === 'json' ? 'font-mono text-xs' : ''}
                onChange={(e) => set(field.key, e.target.value)}
              />
              {error && <p className="mt-1 text-xs text-danger">{error}</p>}
              {help}
            </div>
          );
        }

        if (field.type === 'select') {
          return (
            <div key={field.key}>
              <Select
                label={label}
                value={valueOf(field)}
                onChange={(e) => set(field.key, e.target.value)}
                options={[
                  ...(!field.required && field.default === undefined ? [{ value: '', label: 'None' }] : []),
                  ...(field.options || []).map((option) => ({ value: option.value, label: option.label ?? String(option.value), description: option.description })),
                ]}
              />
              {help}
            </div>
          );
        }

        if (field.type === 'boolean') {
          return (
            <Switch
              key={field.key}
              label={label}
              description={field.help}
              checked={Boolean(values[field.key] ?? field.default)}
              onChange={(v) => set(field.key, v)}
            />
          );
        }

        return (
          <div key={field.key}>
            <TextField
              label={label}
              type={field.type === 'number' ? 'number' : 'text'}
              value={valueOf(field)}
              placeholder={field.placeholder}
              onChange={(e) => set(field.key, e.target.value)}
            />
            {help}
          </div>
        );
      })}

      {showTemplateNote && (
        <p className="text-xs text-subtle">
          Text fields support <code>{'{{input.field}}'}</code> placeholders from the upstream node.
        </p>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { updateTemplate } from '../api/templates';
import { apiErrorMessage } from '../api/client';
import { Button, Dialog, Field, Input, Textarea } from './ui/index';
import { ErrorText } from './ui.jsx';

/** Rename / re-describe a workspace template (spec/36 §5). */
export default function EditTemplateDialog({ template, onClose, onSaved }) {
  const [name, setName] = useState(template.name || '');
  const [description, setDescription] = useState(template.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSaved(await updateTemplate(template._id, { name: name.trim(), description: description.trim() }));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to update template'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit template"
      description="Workflows already created from it don't change."
      icon={Pencil}
      size="sm"
      dismissable={!busy}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={handleSubmit} loading={busy} disabled={!name.trim()}>Save</Button>
        </>
      )}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name" htmlFor="tpl-name" required>
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Description" htmlFor="tpl-desc" help="One or two sentences on the problem it solves.">
          <Textarea id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}

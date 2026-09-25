import { useState } from 'react';
import { updateTemplate } from '../api/templates';
import { apiErrorMessage } from '../api/client';
import { Button, TextField, TextArea, ErrorText } from './ui';

/** Rename / re-describe a workspace template (spec/36 §5). */
export default function EditTemplateDialog({ template, onClose, onSaved }) {
  const [name, setName] = useState(template.name || '');
  const [description, setDescription] = useState(template.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={onClose}>
      <form
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-template-title"
      >
        <h2 id="edit-template-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">Edit template</h2>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        <TextArea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving...' : 'Save'}</Button>
        </div>
      </form>
    </div>
  );
}

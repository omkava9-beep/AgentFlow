import { useState } from 'react';
import { createTemplate } from '../api/templates';
import { apiErrorMessage } from '../api/client';
import { TextField, TextArea, Button, ErrorText } from './ui';

/** "Save as template" from the Builder (spec/15). Snapshots the *saved* graph. */
export default function SaveAsTemplateDialog({ workflowId, defaultName, onClose }) {
  const [name, setName] = useState(`${defaultName} template`);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await createTemplate({ workflowId, name, description });
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to save template'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Save as template</h3>

        {saved ? (
          <>
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              Saved. It now appears under <strong>Your templates</strong> in the Templates gallery.
            </p>
            <Button className="mt-4 w-full" onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Captures the last saved version of this graph as an independent copy.
            </p>
            <div className="mt-4 space-y-3">
              <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <TextArea
                label="Description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this template for?"
              />
              <ErrorText>{error}</ErrorText>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={handleSave} disabled={saving || !name.trim()}>
                  {saving ? 'Saving...' : 'Save template'}
                </Button>
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

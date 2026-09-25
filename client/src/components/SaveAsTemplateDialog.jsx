import { useState } from 'react';
import { CheckCircle2, LayoutTemplate } from 'lucide-react';
import { createTemplate } from '../api/templates';
import { apiErrorMessage } from '../api/client';
import { Button, Dialog, Field, Input, Textarea } from './ui/index';
import { ErrorText } from './ui.jsx';

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

  if (saved) {
    return (
      <Dialog open onClose={onClose} title="Template saved" icon={CheckCircle2} size="sm" footer={<Button onClick={onClose}>Done</Button>}>
        <p className="text-sm text-muted">
          It now appears under <strong className="font-medium text-fg">Your team’s templates</strong> in the Templates gallery, for everyone in this workspace.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Save as template"
      description="Captures the last saved version of this graph as an independent copy. Connections aren't included."
      icon={LayoutTemplate}
      size="sm"
      dismissable={!saving}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} loading={saving} disabled={!name.trim()}>Save template</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="save-tpl-name" required>
          <Input id="save-tpl-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Description" htmlFor="save-tpl-desc">
          <Textarea id="save-tpl-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What problem does it solve?" />
        </Field>
        <ErrorText>{error}</ErrorText>
      </div>
    </Dialog>
  );
}

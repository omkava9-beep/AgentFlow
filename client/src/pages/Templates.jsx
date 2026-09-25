import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listTemplates, createWorkflowFromTemplate, deleteTemplate } from '../api/templates';
import { apiErrorMessage } from '../api/client';
import { ErrorText } from '../components/ui';
import TemplateCard from '../components/TemplateCard';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useCan } from '../hooks/useCan';
import EditTemplateDialog from '../components/EditTemplateDialog';
import { confirm } from '../components/ui/confirm';
import { useToastStore } from '../store/toastStore';
import { SkeletonGrid } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

export default function Templates() {
  const canUse = useCan('templates:use');
  const canManage = useCan('templates:create');
  const [editing, setEditing] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const wp = useWorkspacePath();

  const reload = () => listTemplates()
    .then(setTemplates)
    .catch((err) => setError(apiErrorMessage(err, 'Failed to load templates')))
    .finally(() => setLoading(false));

  useEffect(() => { reload(); }, []);

  async function handleDelete(template) {
    const ok = await confirm({
      title: `Delete "${template.name}"?`,
      body: 'Workflows already created from this template keep working; they are independent copies.',
      confirmLabel: 'Delete template',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTemplate(template._id);
      setTemplates((ts) => ts.filter((t) => t._id !== template._id));
      useToastStore.getState().push('Template deleted.', 'success');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to delete template'));
    }
  }

  async function handleUse(template) {
    setBusyId(template._id);
    setError('');
    try {
      const workflow = await createWorkflowFromTemplate(template._id, `${template.name} copy`);
      navigate(wp(`/workflows/${workflow._id}`));
    } catch (err) {
      // Someone else deleted it while it was on screen (spec/36 edge cases).
      if (err?.response?.status === 404) {
        useToastStore.getState().push('That template was just deleted.', 'info');
        reload();
      } else {
        setError(apiErrorMessage(err, 'Failed to create workflow from template'));
      }
      setBusyId(null);
    }
  }

  const builtIn = templates.filter((t) => t.builtIn);
  const mine = templates.filter((t) => !t.builtIn);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Templates</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Start from a ready-made graph. Using a template creates an independent copy — editing it never
          changes the template.
        </p>
      </div>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <SkeletonGrid count={6} />
      ) : templates.length === 0 ? (
        <EmptyState
          icon="📐"
          title="No templates yet"
          body={<>Run <code>npm run seed:templates</code> in <code>server/</code> to add the built-in ones, or save one of your workflows as a template from the Builder.</>}
        />
      ) : (
        <div className="space-y-8">
          {[
            ['Built-in', builtIn],
            ['Workspace templates', mine],
          ]
            .filter(([, group]) => group.length)
            .map(([heading, group]) => (
              <section key={heading}>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{heading}</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.map((t) => (
                    <TemplateCard
                      key={t._id}
                      template={t}
                      onUse={canUse ? handleUse : undefined}
                      onEdit={canManage && !t.builtIn ? setEditing : undefined}
                      onDelete={canManage && !t.builtIn ? handleDelete : undefined}
                      busy={busyId === t._id}
                    />
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
      {editing && (
        <EditTemplateDialog
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setTemplates((ts) => ts.map((t) => (t._id === updated._id ? { ...t, ...updated, createdByName: t.createdByName } : t)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

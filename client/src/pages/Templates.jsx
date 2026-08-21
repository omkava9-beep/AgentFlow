import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listTemplates, createWorkflowFromTemplate } from '../api/templates';
import { apiErrorMessage } from '../api/client';
import { Card, ErrorText } from '../components/ui';
import TemplateCard from '../components/TemplateCard';

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    listTemplates()
      .then(setTemplates)
      .catch((err) => setError(apiErrorMessage(err, 'Failed to load templates')))
      .finally(() => setLoading(false));
  }, []);

  async function handleUse(template) {
    setBusyId(template._id);
    setError('');
    try {
      const workflow = await createWorkflowFromTemplate(template._id, `${template.name} copy`);
      navigate(`/workflows/${workflow._id}`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to create workflow from template'));
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
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
      ) : templates.length === 0 ? (
        <Card className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
          No templates yet. Run <code>npm run seed:templates</code> in <code>server/</code> to add the built-in
          ones, or save one of your workflows as a template from the Builder.
        </Card>
      ) : (
        <div className="space-y-8">
          {[
            ['Built-in', builtIn],
            ['Your templates', mine],
          ]
            .filter(([, group]) => group.length)
            .map(([heading, group]) => (
              <section key={heading}>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{heading}</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.map((t) => (
                    <TemplateCard key={t._id} template={t} onUse={handleUse} busy={busyId === t._id} />
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}

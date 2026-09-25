import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { History, BarChart3, PencilRuler } from 'lucide-react';
import { getWorkflow } from '../api/workflows';
import { isNotFound } from '../api/client';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import ResourceNotFound from '../components/ResourceNotFound';
import { PageHeader, Button, Badge } from '../components/ui';
import { useBreadcrumb } from '../store/breadcrumbStore';
import Runs from './Runs';

/** One workflow's runs: the workspace Runs table, pinned to this workflow. */
export default function RunHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const wp = useWorkspacePath();
  const [workflow, setWorkflow] = useState(null);
  useBreadcrumb(workflow?.name);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    getWorkflow(id).then(setWorkflow).catch((err) => { if (isNotFound(err)) setNotFound(true); });
  }, [id]);

  if (notFound) return <ResourceNotFound kind="workflow" />;

  return (
    <div>
      <PageHeader
        icon={History}
        breadcrumbs={[{ label: 'Workflows', to: wp('/dashboard') }, { label: workflow?.name || 'Workflow', to: wp(`/workflows/${id}`) }, { label: 'Runs' }]}
        title={workflow ? `${workflow.name} · runs` : 'Run history'}
        meta={workflow?.publishedVersion ? <Badge tone="accent" size="xs">Live v{workflow.publishedVersion}</Badge> : workflow ? <Badge size="xs">Not published</Badge> : null}
        description="Every run of this workflow — test runs of the draft and runs of the published version."
        actions={(
          <>
            <Button size="sm" variant="secondary" icon={BarChart3} onClick={() => navigate(wp(`/analytics/workflows/${id}`))}>Analytics</Button>
            <Button size="sm" icon={PencilRuler} onClick={() => navigate(wp(`/workflows/${id}`))}>Open builder</Button>
          </>
        )}
      />
      <Runs fixedWorkflowId={id} />
    </div>
  );
}

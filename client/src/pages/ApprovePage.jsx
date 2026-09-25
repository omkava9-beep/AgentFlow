import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { UserCheck, LinkIcon, Clock, CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';
import { Card, EmptyState, Skeleton, Badge } from '../components/ui';
import { Wordmark } from '../components/Logo';
import ApprovalDecision from '../components/ApprovalDecision';
import { getApprovalLink, decideApprovalLink } from '../api/approvals';

/**
 * /approve/:token - the signed link from an approval request (spec/32 §8).
 * Opening it never decides (link unfurlers and mail scanners follow GETs);
 * only the buttons do. No app shell: the approver may not be signed in.
 */
export default function ApprovePage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');

  const load = () => getApprovalLink(token)
    .then((d) => { setData(d); setState('ready'); })
    .catch((err) => setState(err?.response?.status === 410 ? 'expired' : 'invalid'));

  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-screen flex-col items-center bg-bg-subtle px-4 py-12">
      <Wordmark className="mb-8 text-base" />
      <Card className="flex w-full max-w-lg flex-col gap-5 p-6 shadow-sm">
        {state === 'loading' && (
          <div className="space-y-3"><Skeleton className="h-4 w-40" /><Skeleton className="h-6 w-3/4" /><Skeleton className="h-20 w-full" /></div>
        )}
        {state === 'invalid' && (
          <EmptyState compact icon={LinkIcon} title="This link isn't valid any more" body="It may have been revoked, the run may have moved on, or you may no longer be an approver." />
        )}
        {state === 'expired' && <EmptyState compact icon={Clock} title="This approval link has expired" body="Ask for a fresh request, or decide from the Approvals inbox in AgentFlow." />}
        {state === 'ready' && data && (
          <>
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning-subtle text-warning-subtle-fg"><UserCheck className="h-4 w-4" aria-hidden="true" /></span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-subtle">{data.workspaceName} · {data.workflowName}{data.status === 'pending' && <Badge tone="warning" size="xs">Waiting for you</Badge>}</p>
                <h1 className="mt-0.5 text-lg font-semibold text-fg">{data.title}</h1>
                {data.description && <p className="mt-1 text-sm text-muted">{data.description}</p>}
              </div>
            </div>
            {data.input !== undefined && data.input !== null && (
              <pre className="max-h-48 overflow-auto rounded-control border border-default bg-surface-sunken p-3 font-mono text-xs text-muted">{JSON.stringify(data.input, null, 2)}</pre>
            )}
            {data.status === 'pending' ? (
              <>
                <p className="flex items-center gap-1.5 text-xs text-subtle"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Deciding as {data.approver?.name}. Opening this link never decides — only the buttons do.</p>
                <ApprovalDecision onDecide={async (decision, comment) => {
                  const result = await decideApprovalLink(token, decision, comment);
                  await load();
                  return result;
                }} />
              </>
            ) : (
              <p className="flex items-start gap-2 rounded-control border border-default bg-bg-subtle p-3 text-sm text-muted">
                {data.decision === 'rejected' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />}
                <span>Already {data.decision || data.status}
                {data.decidedBy && ` by ${data.decidedBy === 'timeout' ? 'the timeout' : data.decidedBy.name}`}
                {data.decidedAt && ` at ${new Date(data.decidedAt).toLocaleString()}`}.</span>
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

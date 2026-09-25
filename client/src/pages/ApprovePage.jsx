import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '../components/ui';
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
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="flex w-full max-w-lg flex-col gap-4 p-6">
        {state === 'loading' && <p className="text-sm text-slate-500">Loading…</p>}
        {state === 'invalid' && (
          <p className="text-sm text-slate-600 dark:text-slate-300">This approval link isn't valid any more. It may have been revoked, or you may no longer be an approver.</p>
        )}
        {state === 'expired' && <p className="text-sm text-slate-600 dark:text-slate-300">This approval link has expired.</p>}
        {state === 'ready' && data && (
          <>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">{data.workspaceName} · {data.workflowName}</p>
              <h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{data.title}</h1>
              {data.description && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{data.description}</p>}
            </div>
            {data.input !== undefined && data.input !== null && (
              <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-3 text-xs dark:bg-slate-900">{JSON.stringify(data.input, null, 2)}</pre>
            )}
            {data.status === 'pending' ? (
              <>
                <p className="text-xs text-slate-500">Deciding as {data.approver?.name}.</p>
                <ApprovalDecision onDecide={async (decision, comment) => {
                  const result = await decideApprovalLink(token, decision, comment);
                  await load();
                  return result;
                }} />
              </>
            ) : (
              <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                Already {data.decision || data.status}
                {data.decidedBy && ` by ${data.decidedBy === 'timeout' ? 'the timeout' : data.decidedBy.name}`}
                {data.decidedAt && ` at ${new Date(data.decidedAt).toLocaleString()}`}.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

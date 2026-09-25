import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { listVersions, restoreVersion, rollbackVersion } from '../../api/workflows';
import { apiErrorMessage } from '../../api/client';
import { on } from '../../realtime/socket';
import { useToastStore } from '../../store/toastStore';
import { useCan } from '../../hooks/useCan';

const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

/**
 * spec/30 versions drawer: every version with View / Compare / Restore to
 * draft / Roll back. Viewers can open it and view or compare; nothing else.
 */
export default function VersionsDrawer({ workflowId, onView, onCompare, onClose, onChanged }) {
  const canEdit = useCan('workflow:edit');
  const canPublish = useCan('workflow:publish');
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // { kind: 'restore' | 'rollback', version }
  const [busy, setBusy] = useState(false);
  const toast = (m) => useToastStore.getState().push(m, 'info');

  const load = useCallback(() => listVersions(workflowId).then(setVersions).catch((err) => setError(apiErrorMessage(err, 'Failed to load versions'))), [workflowId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => on('version:published', (p) => String(p?.workflowId) === String(workflowId) && load()), [workflowId, load]);

  const latest = versions?.[0]?.version;

  async function act() {
    const { kind, version } = confirm;
    setBusy(true);
    setError('');
    try {
      if (kind === 'restore') {
        await restoreVersion(workflowId, version);
        toast(`Draft restored to v${version}. Nothing was published.`);
      } else {
        const { version: created } = await rollbackVersion(workflowId, version);
        toast(`Rolled back: v${version} is live again as v${created.version}.`);
      }
      setConfirm(null);
      onChanged?.();
      load();
    } catch (err) {
      setError(apiErrorMessage(err, kind === 'restore' ? 'Restore failed' : 'Roll back failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-96 flex-col border-l border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Versions</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      {error && <p className="px-4 pt-3 text-xs text-red-500">{error}</p>}
      <div className="flex-1 overflow-y-auto p-3">
        {!versions && !error && <p className="text-sm text-slate-400">Loading…</p>}
        {versions?.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">Never published. Schedules, webhooks, events and API calls skip this workflow until you publish it.</p>
        )}
        <ul className="space-y-2">
          {versions?.map((v) => (
            <li key={v.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-800 dark:text-slate-100">v{v.version}</span>
                {v.isLive && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Live</span>}
                {v.rolledBackFrom && <span className="text-[11px] text-slate-500">rollback of v{v.rolledBackFrom}</span>}
                {v.warningsCount > 0 && <span className="text-[11px] text-amber-600 dark:text-amber-400" title={v.warnings.map((w) => w.message).join('\n')}>⚠ {v.warningsCount}</span>}
                <span className="ml-auto text-[11px] text-slate-400">{v.nodeCount} nodes</span>
              </div>
              {v.message && <p className="mt-1 text-slate-600 dark:text-slate-300">{v.message}</p>}
              <p className="mt-1 text-[11px] text-slate-400">{v.publishedBy?.name || 'someone'} · {when(v.createdAt)}</p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <LinkButton onClick={() => onView(v.version)}>View</LinkButton>
                <LinkButton onClick={() => onCompare(v.version, 'draft')}>Compare with draft</LinkButton>
                {v.version > 1 && <LinkButton onClick={() => onCompare(v.version - 1, v.version)}>Compare with v{v.version - 1}</LinkButton>}
                {canEdit && <LinkButton onClick={() => setConfirm({ kind: 'restore', version: v.version })}>Restore to draft</LinkButton>}
                {canPublish && v.version !== latest && <LinkButton onClick={() => setConfirm({ kind: 'rollback', version: v.version })}>Roll back to this</LinkButton>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {confirm && (
        <div className="border-t border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-950">
          <p className="text-slate-700 dark:text-slate-200">
            {confirm.kind === 'restore'
              ? `Replace the draft with v${confirm.version} for everyone editing it? Nothing is published; triggers keep running the live version.`
              : `This publishes v${confirm.version}'s graph as v${(latest || 0) + 1}. Triggers switch immediately.`}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={act} disabled={busy} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {busy ? 'Working…' : confirm.kind === 'restore' ? 'Restore draft' : 'Roll back'}
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkButton({ onClick, children }) {
  return <button type="button" onClick={onClick} className="text-brand-600 hover:underline dark:text-brand-400">{children}</button>;
}

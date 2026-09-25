import { useEffect, useState } from 'react';
import { TextField, TextArea, Select } from '../ui';
import { listMembers } from '../../api/members';
import { useWorkspaceStore } from '../../store/workspaceStore';

const ROLE_CHIPS = ['owner', 'admin', 'editor', 'viewer'];
const UNITS = [
  { label: 'minutes', ms: 60 * 1000 },
  { label: 'hours', ms: 60 * 60 * 1000 },
  { label: 'days', ms: 24 * 60 * 60 * 1000 },
];

function splitDuration(ms) {
  if (!ms) return { amount: 1, unit: UNITS[1] };
  const unit = [...UNITS].reverse().find((u) => ms % u.ms === 0) || UNITS[0];
  return { amount: Math.round(ms / unit.ms), unit };
}

/**
 * spec/32: title/description templates, assignees (members + role chips), the
 * number of approvals needed, an optional timeout with a default outcome, and
 * whether the approver sees the input.
 */
export default function ApprovalPanel({ config, set, readOnly }) {
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  const [members, setMembers] = useState([]);
  useEffect(() => {
    if (!workspaceId) return;
    listMembers(workspaceId).then(setMembers).catch(() => setMembers([]));
  }, [workspaceId]);

  const assignees = config.assignees || { userIds: [], roles: [] };
  const userIds = assignees.userIds || [];
  const roles = assignees.roles || [];
  const setAssignees = (patch) => set({ assignees: { userIds, roles, ...patch } });
  const toggle = (list, value) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const timeout = config.timeout || null;
  const { amount, unit } = splitDuration(timeout?.afterMs);
  const nobody = !userIds.length && !roles.length;

  return (
    <>
      <TextField
        label="Title"
        value={config.title || ''}
        onChange={(e) => set({ title: e.target.value })}
        placeholder="Refund {{input.amount}} to {{input.customer}}?"
        disabled={readOnly}
      />
      <TextArea
        label="Description"
        rows={2}
        value={config.description || ''}
        onChange={(e) => set({ description: e.target.value })}
        placeholder="Shown to the approver. Supports {{input.field}}."
        disabled={readOnly}
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Assignees</span>
        <div className="flex flex-wrap gap-1.5">
          {ROLE_CHIPS.map((role) => (
            <button
              key={role}
              type="button"
              disabled={readOnly}
              onClick={() => setAssignees({ roles: toggle(roles, role) })}
              className={`rounded-full border px-2 py-0.5 text-xs capitalize transition ${roles.includes(role)
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                : 'border-slate-300 text-slate-500 dark:border-slate-700'}`}
            >
              every {role}
            </button>
          ))}
        </div>
        <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 p-1 dark:border-slate-700">
          {members.map((m) => (
            <label key={m.userId} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={userIds.includes(m.userId)}
                onChange={() => setAssignees({ userIds: toggle(userIds, m.userId) })}
              />
              <span className="truncate">{m.name || m.email}</span>
              <span className="ml-auto text-[10px] uppercase text-slate-400">{m.role}</span>
            </label>
          ))}
          {!members.length && <p className="px-2 py-1 text-xs text-slate-400">Loading members…</p>}
        </div>
        {nobody && <p className="text-xs text-slate-400">No one picked: owners and admins will be asked.</p>}
      </div>

      <TextField
        label="Approvals needed"
        type="number"
        min={1}
        value={config.minApprovals ?? 1}
        onChange={(e) => set({ minApprovals: Math.max(1, Number(e.target.value) || 1) })}
        disabled={readOnly}
      />
      <p className="-mt-1 text-xs text-slate-400">The first rejection decides straight away.</p>

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          disabled={readOnly}
          checked={Boolean(timeout)}
          onChange={(e) => set({ timeout: e.target.checked ? { afterMs: 60 * 60 * 1000, outcome: 'rejected' } : null })}
        />
        Time out
      </label>
      {timeout && (
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            label="After"
            type="number"
            min={1}
            className="w-20"
            value={amount}
            onChange={(e) => set({ timeout: { ...timeout, afterMs: Math.max(1, Number(e.target.value) || 1) * unit.ms } })}
            disabled={readOnly}
          />
          <Select
            label="Unit"
            value={unit.label}
            onChange={(e) => {
              const next = UNITS.find((u) => u.label === e.target.value);
              set({ timeout: { ...timeout, afterMs: amount * next.ms } });
            }}
            disabled={readOnly}
          >
            {UNITS.map((u) => <option key={u.label} value={u.label}>{u.label}</option>)}
          </Select>
          <Select
            label="Then"
            value={timeout.outcome || 'rejected'}
            onChange={(e) => set({ timeout: { ...timeout, outcome: e.target.value } })}
            disabled={readOnly}
          >
            <option value="rejected">auto-reject</option>
            <option value="approved">auto-approve</option>
          </Select>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          disabled={readOnly}
          checked={config.showInput !== false}
          onChange={(e) => set({ showInput: e.target.checked })}
        />
        Show the input to the approver
      </label>
    </>
  );
}

/** Icon and label per notification kind (spec/29 §4). */
export const KIND_META = {
  mention: { icon: '@', label: 'Mention' },
  comment_reply: { icon: '💬', label: 'Reply' },
  invite: { icon: '✉️', label: 'Invite' },
  run_failed: { icon: '⚠️', label: 'Run failed' },
  approval_requested: { icon: '✋', label: 'Approval needed' },
  approval_resolved: { icon: '✅', label: 'Approval decided' },
  role_changed: { icon: '🛡️', label: 'Role changed' },
};

export const kindMeta = (kind) => KIND_META[kind] || { icon: '🔔', label: 'Notification' };

/** "failed 7 times since 14:02" for a collapsed row (spec/29 §5). */
export function collapsedNote(n) {
  if (!n.count || n.count < 2) return null;
  const since = new Date(n.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${n.count} times since ${since}`;
}

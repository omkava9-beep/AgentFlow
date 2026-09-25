import { AtSign, MessageSquare, Mail, AlertTriangle, UserCheck, CheckCircle2, ShieldCheck, Bell } from 'lucide-react';

/** Icon (lucide component), tone and label per notification kind (spec/29 §4). */
export const KIND_META = {
  mention: { icon: AtSign, tone: 'accent', label: 'Mention' },
  comment_reply: { icon: MessageSquare, tone: 'accent', label: 'Reply' },
  invite: { icon: Mail, tone: 'info', label: 'Invite' },
  run_failed: { icon: AlertTriangle, tone: 'danger', label: 'Run failed' },
  approval_requested: { icon: UserCheck, tone: 'warning', label: 'Approval needed' },
  approval_resolved: { icon: CheckCircle2, tone: 'success', label: 'Approval decided' },
  role_changed: { icon: ShieldCheck, tone: 'neutral', label: 'Role changed' },
};

export const kindMeta = (kind) => KIND_META[kind] || { icon: Bell, tone: 'neutral', label: 'Notification' };

/** "failed 7 times since 14:02" for a collapsed row (spec/29 §5). */
export function collapsedNote(n) {
  if (!n.count || n.count < 2) return null;
  const since = new Date(n.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${n.count} times since ${since}`;
}

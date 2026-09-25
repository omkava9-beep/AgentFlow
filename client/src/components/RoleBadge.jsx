import { Badge } from './ui/Badge';

const TONES = { owner: 'accent', admin: 'info', editor: 'success', viewer: 'neutral' };

export default function RoleBadge({ role }) {
  if (!role) return null;
  return <Badge tone={TONES[role] || 'neutral'} size="xs" className="capitalize">{role}</Badge>;
}

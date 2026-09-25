import { Play, Clock, Webhook, Zap, KeyRound, FlaskConical, Workflow } from 'lucide-react';
import { Badge } from './ui/Badge';

const STYLES = {
  manual: { label: 'Manual', icon: Play, tone: 'neutral' },
  schedule: { label: 'Scheduled', icon: Clock, tone: 'accent' },
  webhook: { label: 'Webhook', icon: Webhook, tone: 'info' },
  event: { label: 'Event', icon: Zap, tone: 'warning' },
  api: { label: 'API', icon: KeyRound, tone: 'success' },
  subworkflow: { label: 'Sub-workflow', icon: Workflow, tone: 'neutral' },
};

/**
 * With five ways to start a run, "where did this one come from?" is a real
 * question. API runs (spec/24) name the key that started them when known.
 */
export default function TriggerBadge({ trigger, apiKeyName, test = false }) {
  const style = STYLES[trigger] || STYLES.manual;
  const title = trigger === 'api' && apiKeyName
    ? `Started by: API key "${apiKeyName}"`
    : `Started by: ${style.label.toLowerCase()} trigger`;
  const badge = <Badge tone={style.tone} icon={style.icon} title={title}>{style.label}</Badge>;
  if (!test) return badge;
  // spec/27 §5: runs started by "Send test event" carry a sample payload.
  return (
    <span className="inline-flex items-center gap-1">
      {badge}
      <Badge tone="warning" icon={FlaskConical} title="Started by “Send test event” with a sample payload">Test</Badge>
    </span>
  );
}

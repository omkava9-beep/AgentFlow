import { FlaskConical, Tag } from 'lucide-react';
import { Badge, Tooltip } from '../ui';

/**
 * spec/30: which graph a run executed, beside its trigger badge - "v3" for a
 * published run, "Draft" for a Builder test run. `long` is the monitor header's
 * wording ("Ran v3" / "Test run on draft").
 */
export default function VersionBadge({ isDraft, versionNumber, long = false }) {
  if (!isDraft && !versionNumber) return null;
  const draft = Boolean(isDraft);
  const text = draft ? (long ? 'Test run on draft' : 'Draft') : long ? `Ran v${versionNumber}` : `v${versionNumber}`;
  return (
    <Tooltip content={draft ? 'A test run of the draft, from the Builder' : `Ran published version ${versionNumber}`}>
      <span className="inline-flex">
        <Badge tone={draft ? 'warning' : 'accent'} icon={draft ? FlaskConical : Tag} size="xs">{text}</Badge>
      </span>
    </Tooltip>
  );
}

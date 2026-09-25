import { Braces } from 'lucide-react';
import { CopyButton, EmptyState } from '../ui';

/** Pretty-printed JSON with a copy button; an empty state when there's nothing. */
export default function JsonView({ value, emptyTitle = 'Nothing here', emptyBody, maxHeight = 'max-h-[60vh]' }) {
  if (value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) {
    return <EmptyState compact icon={Braces} title={emptyTitle} body={emptyBody} />;
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div className="relative">
      <div className="absolute right-2 top-2"><CopyButton value={text} /></div>
      <pre className={`${maxHeight} overflow-auto whitespace-pre-wrap break-words rounded-control border border-default bg-surface-sunken p-3 pr-12 font-mono text-xs leading-relaxed text-fg`}>{text}</pre>
    </div>
  );
}

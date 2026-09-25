import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { IconButton } from './Button';
import Button from './Button';

/** Copies `value` and flips to a check for a moment. `label` shows a text button instead of an icon. */
export default function CopyButton({ value, label, size = 'sm', variant, className = '' }) {
  const [copied, setCopied] = useState(false);
  async function copy(e) {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(value); } catch { /* clipboard blocked: nothing to do */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  if (label) {
    return <Button variant={variant || 'secondary'} size={size} icon={copied ? Check : Copy} onClick={copy} className={className}>{copied ? 'Copied' : label}</Button>;
  }
  return <IconButton icon={copied ? Check : Copy} label={copied ? 'Copied' : 'Copy'} size={size} onClick={copy} className={className} variant={variant || 'ghost'} />;
}

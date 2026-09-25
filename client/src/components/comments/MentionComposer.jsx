import { useMemo, useRef, useState } from 'react';
import { activeMentionQuery, encodeMentions } from '../../utils/mentions';
import { useWorkspaceMembers } from './useWorkspaceMembers';

/**
 * Plain-text composer with `@` autocomplete over current members (spec/29 §3).
 * ⌘↵ / Ctrl↵ sends, Escape cancels.
 */
export default function MentionComposer({ initialText = '', initialPicked = [], placeholder = 'Add a comment… (@ to mention)', submitLabel = 'Comment', onSubmit, onCancel, autoFocus = true }) {
  const members = useWorkspaceMembers();
  const [text, setText] = useState(initialText);
  const [picked, setPicked] = useState(initialPicked);
  const [caret, setCaret] = useState(initialText.length);
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);

  const mention = activeMentionQuery(text, caret);
  const suggestions = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return members
      .filter((m) => (m.name || m.email).toLowerCase().includes(q) || m.email.toLowerCase().startsWith(q))
      .slice(0, 6);
  }, [mention, members]);

  function choose(member) {
    const name = member.name || member.email;
    const before = text.slice(0, mention.start);
    const after = text.slice(caret);
    const next = `${before}@${name} ${after}`;
    setText(next);
    setPicked((prev) => (prev.some((p) => p.id === member.userId) ? prev : [...prev, { id: member.userId, name }]));
    const pos = before.length + name.length + 2;
    setCaret(pos);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  }

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    try {
      // Only names still present in the text become tokens.
      await onSubmit(encodeMentions(trimmed, picked.filter((p) => trimmed.includes(`@${p.name}`))));
      setText('');
      setPicked([]);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not send the comment');
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => (h + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(suggestions[Math.min(highlight, suggestions.length - 1)]); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); return; }
    if (e.key === 'Escape') { e.stopPropagation(); onCancel?.(); }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        value={text}
        rows={2}
        maxLength={4000}
        placeholder={placeholder}
        data-testid="comment-composer"
        onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); setHighlight(0); }}
        onSelect={(e) => setCaret(e.target.selectionStart)}
        onKeyDown={onKeyDown}
        className="w-full resize-y rounded-lg border border-default bg-surface px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
      />
      {suggestions.length > 0 && (
        <ul className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-lg border border-default bg-surface shadow-lg" data-testid="mention-suggestions">
          {suggestions.map((m, i) => (
            <li key={m.userId}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); choose(m); }}
                className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-sm ${i === highlight ? 'bg-accent-subtle ' : ''}`}
              >
                <span className="font-medium text-fg">{m.name || m.email}</span>
                <span className="text-xs text-subtle">{m.role}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <div className="mt-1.5 flex items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-subtle">⌘↵ to send</span>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-bg-subtle">
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || busy}
          data-testid="comment-submit"
          className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent disabled:opacity-40"
        >
          {busy ? 'Sending…' : submitLabel}
        </button>
      </div>
    </div>
  );
}

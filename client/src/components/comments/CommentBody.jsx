import { mentionParts } from '../../utils/mentions';

/** A comment's text with `{{@id}}` tokens rendered as @Name chips. */
export default function CommentBody({ comment }) {
  if (comment.deleted) return <p className="text-sm italic text-slate-400">Comment deleted</p>;
  return (
    <p className="whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-200">
      {mentionParts(comment.body, comment.mentions).map((part, i) => (part.mention ? (
        <span key={i} className="rounded bg-brand-100 px-1 font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
          @{part.mention.name}
        </span>
      ) : (
        <span key={i}>{linkify(part.text)}</span>
      )))}
    </p>
  );
}

/** Auto-linked URLs are the only rich text (spec/29 non-goals). */
function linkify(text) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => (/^https?:\/\//.test(p)
    ? <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="text-brand-600 underline dark:text-brand-400">{p}</a>
    : p));
}

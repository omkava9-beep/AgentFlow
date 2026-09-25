/**
 * spec/30 UI: "Live: v3", "Live: v3 · unpublished changes" (amber) or
 * "Never published" (grey). Clicking it opens the versions drawer.
 */
export default function VersionChip({ publishedVersion, hasUnpublishedChanges, onClick }) {
  const never = !publishedVersion;
  const tone = never
    ? 'border-slate-200 bg-white/80 text-slate-500 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-400'
    : hasUnpublishedChanges
      ? 'border-amber-300 bg-amber-50/90 text-amber-800 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
      : 'border-emerald-200 bg-emerald-50/90 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/80 dark:text-emerald-300';
  return (
    <button
      type="button"
      onClick={onClick}
      title="Version history"
      className={`rounded-full border px-3 py-1 text-xs font-medium shadow-sm backdrop-blur-sm transition hover:brightness-95 ${tone}`}
    >
      {never ? 'Never published' : `Live: v${publishedVersion}${hasUnpublishedChanges ? ' · unpublished changes' : ''}`}
    </button>
  );
}

/**
 * spec/30 UI: "Live: v3", "Live: v3 · unpublished changes" (amber) or
 * "Never published" (grey). Clicking it opens the versions drawer.
 */
export default function VersionChip({ publishedVersion, hasUnpublishedChanges, onClick }) {
  const never = !publishedVersion;
  const tone = never
    ? 'border-default bg-surface/80 text-muted   '
    : hasUnpublishedChanges
      ? 'border-warning/30 bg-warning-subtle/90 text-warning-subtle-fg   '
      : 'border-success/30 bg-success-subtle/90 text-success-subtle-fg   ';
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

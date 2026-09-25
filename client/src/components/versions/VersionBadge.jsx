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
    <span
      title={draft ? 'A test run of the draft, from the Builder' : `Ran published version ${versionNumber}`}
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        draft
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
          : 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
      }`}
    >
      {text}
    </span>
  );
}

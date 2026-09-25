const STYLES = {
  owner: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  admin: 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300',
  editor: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  viewer: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

export default function RoleBadge({ role }) {
  if (!role) return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STYLES[role] || STYLES.viewer}`}>
      {role}
    </span>
  );
}

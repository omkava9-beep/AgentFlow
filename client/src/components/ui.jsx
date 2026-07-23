export function Card({ className = '', children }) {
  return (
    <div
      className={`rounded-xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur-sm dark:border-slate-800/80 dark:bg-slate-900/70 ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({ variant = 'primary', className = '', ...props }) {
  const base =
    'rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none';
  const variants = {
    primary:
      'bg-gradient-to-br from-brand-500 to-purple-600 text-white shadow-sm shadow-brand-500/30 hover:shadow-md hover:shadow-brand-500/40 hover:brightness-110',
    secondary:
      'border border-slate-200 bg-white/60 text-slate-700 backdrop-blur-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800',
    danger: 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-sm shadow-red-500/30 hover:brightness-110',
    ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function TextField({ label, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>}
      <input
        className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 ${className}`}
        {...props}
      />
    </label>
  );
}

export function TextArea({ label, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>}
      <textarea
        className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 ${className}`}
        {...props}
      />
    </label>
  );
}

export function Select({ label, className = '', children, ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>}
      <select
        className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 ${className}`}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <p className="text-sm text-red-600 dark:text-red-400">{children}</p>;
}

export function StatusBadge({ status }) {
  const styles = {
    pending: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    running: 'bg-blue-100 text-blue-700 animate-pulse dark:bg-blue-950 dark:text-blue-300',
    success: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
    skipped: 'bg-slate-100 text-slate-400 line-through dark:bg-slate-800 dark:text-slate-500',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[status] || styles.pending}`}>
      {status}
    </span>
  );
}

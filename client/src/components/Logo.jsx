export default function Logo({ className = 'h-7 w-7' }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" className="fill-brand-600" />
      <circle cx="16" cy="32" r="7" fill="#ffffff" />
      <circle cx="48" cy="16" r="7" fill="#ffffff" fillOpacity="0.85" />
      <circle cx="48" cy="48" r="7" fill="#ffffff" fillOpacity="0.85" />
      <path d="M22 29L41 18M22 35L41 46" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className = '' }) {
  return (
    <span className={`flex items-center gap-2 font-semibold text-brand-600 dark:text-brand-400 ${className}`}>
      <Logo />
      AgentFlow
    </span>
  );
}

import { ShieldCheck, Users, Plug } from 'lucide-react';
import { Wordmark } from './Logo';

const POINTS = [
  { icon: Plug, title: 'Connect your stack', text: 'Slack, GitHub, Stripe, HTTP and any MCP server — live or sandboxed.' },
  { icon: Users, title: 'Build together', text: 'Co-edit workflows in real time, comment, review and publish versions.' },
  { icon: ShieldCheck, title: 'Stay in control', text: 'Roles, approvals, encrypted credentials and a full audit log.' },
];

/** A small, static picture of the product: a workflow on a dotted canvas. */
function CanvasIllustration() {
  const node = (x, y, w, label, tint, sub) => (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height="46" rx="9" className="fill-surface stroke-[rgb(var(--border))]" strokeWidth="1" />
      <rect x="0" y="0" width="3" height="46" rx="1.5" fill={tint} />
      <rect x="12" y="11" width="24" height="24" rx="6" fill={tint} fillOpacity="0.14" />
      <circle cx="24" cy="23" r="4.5" fill={tint} />
      <text x="46" y="21" className="fill-fg" fontSize="11" fontWeight="600">{label}</text>
      <text x="46" y="35" className="fill-[rgb(var(--text-subtle))]" fontSize="9.5">{sub}</text>
    </g>
  );
  return (
    <svg viewBox="0 0 520 300" className="w-full" role="img" aria-label="A workflow: Stripe event, AI agent, approval, then Slack and GitHub">
      <defs>
        <pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" className="fill-[rgb(var(--canvas-dot))]" />
        </pattern>
      </defs>
      <rect width="520" height="300" rx="14" fill="url(#dots)" />
      <g className="stroke-[rgb(var(--border-strong))]" fill="none" strokeWidth="1.5">
        <path d="M150 73 C 178 73, 172 150, 196 150" />
        <path d="M326 150 L 370 150" />
        <path d="M437 173 C 437 200, 262 196, 250 225" />
        <path d="M437 173 C 437 200, 445 208, 445 225" />
      </g>
      {node(20, 50, 130, 'Payment failed', '#635BFF', 'Stripe · trigger')}
      {node(196, 127, 130, 'Triage agent', '#6366f1', 'Agent · 2 tools')}
      {node(370, 127, 134, 'Refund approval', '#f97316', 'Human approval')}
      {node(180, 225, 140, 'Notify #billing', '#4A154B', 'Slack')}
      {node(380, 225, 124, 'Open ticket', '#71717a', 'GitHub')}
      {/* A run just went through: success ticks on the finished nodes. */}
      {[[144, 44], [320, 121]].map(([x, y]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
          <circle r="7" fill="#16a34a" />
          <path d="M-3 0.2 L-0.8 2.4 L3.2 -2" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}
      <g transform="translate(498 121)">
        <circle r="7" fill="#f97316" />
        <path d="M-2.2 -2.5 V2.5 M2.2 -2.5 V2.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export default function AuthLayout({ children }) {
  return (
    <div className="flex min-h-screen bg-bg">
      <div className="flex w-full flex-col px-6 py-8 lg:w-[480px] lg:shrink-0 lg:px-12">
        <Wordmark className="text-base" />
        <div className="flex flex-1 items-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="text-xs text-subtle">© AgentFlow · Workflow automation for AI agents</p>
      </div>
      <div className="relative hidden flex-1 flex-col justify-center overflow-hidden border-l border-default bg-bg-subtle px-12 py-16 lg:flex">
        <div className="mx-auto w-full max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">AI agent orchestration</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-fg">
            Automate real work with agents, tools and people in the loop.
          </h2>
          <div className="mt-8 rounded-dialog border border-default bg-surface p-3 shadow-sm">
            <CanvasIllustration />
          </div>
          <ul className="mt-8 grid gap-5 sm:grid-cols-3">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium text-fg">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

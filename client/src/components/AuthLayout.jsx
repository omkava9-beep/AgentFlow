import { FlowIcon, NodeDotsIcon, PulseIcon, CpuIcon } from './icons';

const FEATURES = [
  { icon: NodeDotsIcon, text: 'Design multi-agent workflows visually' },
  { icon: PulseIcon, text: 'Watch every run execute live, node by node' },
  { icon: CpuIcon, text: 'Swap mock agents for a real LLM anytime' },
];

export default function AuthLayout({ children }) {
  return (
    <div className="flex min-h-screen">
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-purple-800 p-12 text-white lg:flex">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute bottom-0 left-0 h-64 w-64 rounded-full bg-purple-400/20 blur-3xl" />
        </div>

        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
            <FlowIcon className="h-6 w-6" />
          </div>
          <span className="text-xl font-semibold">AgentFlow</span>
        </div>

        <div className="relative">
          <h1 className="mb-4 text-3xl font-semibold leading-tight">
            Build and run AI agent workflows, visually.
          </h1>
          <p className="mb-8 max-w-sm text-white/70">
            Wire agents and tools into a workflow, trigger a run, and watch execution happen live —
            powered by a real async job queue underneath.
          </p>
          <ul className="space-y-3">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/85">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="h-4 w-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/50">Internship project — prototype, not production.</p>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-12">{children}</div>
    </div>
  );
}

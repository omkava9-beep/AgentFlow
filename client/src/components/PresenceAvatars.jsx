import { usePresence } from '../collab/usePresence';
import { useWorkflowStore } from '../store/workflowStore';

const MAX_SHOWN = 4;

const initials = (name = '') =>
  name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

/**
 * Who else is on this workflow (spec/28 UI). Tabs of the same person collapse
 * into one avatar; hovering says what they're doing, clicking pans to their cursor.
 */
export default function PresenceAvatars({ onFocusPeer }) {
  const { people, others, locks } = usePresence();
  const nodes = useWorkflowStore((s) => s.nodes);
  if (!people.length) return null;

  const doing = (person) => {
    const lockedNodeId = Object.entries(locks).find(([, l]) => String(l.userId) === String(person.userId))?.[0];
    if (lockedNodeId) {
      const label = nodes.find((n) => n.id === lockedNodeId)?.data?.config?.label || 'a node';
      return `editing ${label}`;
    }
    return person.away ? 'away' : 'viewing';
  };

  const shown = people.slice(0, MAX_SHOWN);
  const extra = people.length - shown.length;

  return (
    <div data-testid="presence-avatars" className="flex items-center -space-x-2">
      {shown.map((person) => {
        const tab = others.find((p) => p.userId === person.userId && p.cursor) || person;
        return (
          <button
            key={person.userId}
            type="button"
            onClick={() => onFocusPeer?.(tab)}
            title={`${person.name} · ${person.role}${person.tabs > 1 ? ` · ${person.tabs} tabs` : ''} — ${doing(person)}`}
            className={`relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white shadow-sm transition hover:z-10 hover:scale-110 dark:border-slate-900 ${person.away ? 'opacity-50' : ''}`}
            style={{ backgroundColor: person.color }}
          >
            {initials(person.name)}
            {person.role === 'viewer' && (
              <span className="absolute -bottom-1 -right-1 rounded bg-slate-700 px-1 text-[9px] font-medium leading-3 text-white">
                view
              </span>
            )}
          </button>
        );
      })}
      {extra > 0 && (
        <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-500 text-xs font-semibold text-white dark:border-slate-900">
          +{extra}
        </span>
      )}
    </div>
  );
}

import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usePresence, cursorVisible } from '../collab/usePresence';
import { useWorkflowStore } from '../store/workflowStore';

/**
 * Overlay for other people's cursors and lock chips, positioned through React
 * Flow's viewport transform so a cursor stays on the same spot of the graph
 * whatever each person's pan and zoom (spec/28 UI). Pointer events pass through.
 */
export default function RemoteCursors({ viewport, width, height }) {
  const { others, locks, selfSocketId } = usePresence();
  const nodes = useWorkflowStore((s) => s.nodes);
  const [now, setNow] = useState(Date.now());

  // Re-evaluate idleness even when nobody is moving.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, []);

  if (!viewport) return null;
  const toScreen = (x, y) => ({ left: x * viewport.zoom + viewport.x, top: y * viewport.zoom + viewport.y });
  const onScreen = ({ left, top }) => left >= -20 && top >= -20 && left <= (width || 1e6) + 20 && top <= (height || 1e6) + 20;

  const lockChips = Object.entries(locks)
    .filter(([, l]) => l.socketId !== selfSocketId)
    .map(([nodeId, l]) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return null;
      const peer = others.find((p) => p.socketId === l.socketId);
      const pos = toScreen(node.position.x, node.position.y);
      return { nodeId, name: l.name || peer?.name || 'Someone', color: peer?.color || '#64748b', pos };
    })
    .filter(Boolean);

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" aria-hidden="true">
      {lockChips.map(({ nodeId, name, color, pos }) => (
        <span
          key={`lock-${nodeId}`}
          data-testid="lock-chip"
          className="absolute -translate-y-full whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white shadow"
          style={{ left: pos.left, top: pos.top - 4, backgroundColor: color }}
        >
          <Lock className="mr-0.5 inline h-2.5 w-2.5 align-[-1px]" aria-hidden="true" />{name}
        </span>
      ))}

      {others.filter((p) => cursorVisible(p, now)).map((peer) => {
        const pos = toScreen(peer.cursor.x, peer.cursor.y);
        if (!onScreen(pos)) return null;
        return (
          <div key={peer.socketId} data-testid="remote-cursor" className="absolute transition-transform duration-75" style={{ left: pos.left, top: pos.top }}>
            <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow">
              <path d="M2 2 L16 9 L9 10.5 L6.5 16 Z" fill={peer.color} stroke="white" strokeWidth="1.2" />
            </svg>
            <span
              className="ml-3 mt-0.5 inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white shadow"
              style={{ backgroundColor: peer.color }}
            >
              {peer.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

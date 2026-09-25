import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { createThread, repinThread } from '../../api/comments';
import { useCan } from '../../hooks/useCan';
import { useToastStore } from '../../store/toastStore';
import { useThreads } from './useThreads';
import ThreadPopover from './ThreadPopover';
import ThreadListPanel from './ThreadListPanel';
import MentionComposer from './MentionComposer';

const DEFAULT_NODE_WIDTH = 180;
const POPOVER_WIDTH = 330;

const isTyping = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * Comments on the canvas (spec/29 UI): a Comment mode (shortcut C) that drops
 * a pin on a node or an empty spot, pins that follow their node as it moves
 * (including a collaborator's drag), a thread popover, and a thread list.
 *
 * It sits over the React Flow canvas as a pointer-transparent overlay; only
 * pins and popovers take clicks, except while placing a pin.
 */
export default function CommentsLayer({ workflowId, nodes, viewport, flowRef, width, controlsTarget = null }) {
  const canComment = useCan('comments:write');
  const api = useThreads(workflowId);
  const { threads } = api;
  const [mode, setMode] = useState(false);
  const [draft, setDraft] = useState(null); // { anchor, screen }
  const [activeId, setActiveId] = useState(null);
  const [listOpen, setListOpen] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [repinning, setRepinning] = useState(null);
  const overlayRef = useRef(null);
  const [params, setParams] = useSearchParams();

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const toScreen = useCallback((p) => ({ left: p.x * viewport.zoom + viewport.x, top: p.y * viewport.zoom + viewport.y }), [viewport]);

  /** Where a thread's pin sits, in flow coordinates - or null if it has no place on the canvas. */
  const flowPointOf = useCallback((thread) => {
    const { anchor } = thread;
    if (anchor.type === 'node' && !anchor.detached) {
      const node = nodesById.get(anchor.nodeId);
      if (!node) return null;
      return { x: node.position.x + (node.width || DEFAULT_NODE_WIDTH), y: node.position.y };
    }
    if (anchor.type === 'canvas') return { x: anchor.x, y: anchor.y };
    return null;
  }, [nodesById]);

  // C toggles comment mode; Escape backs out of whatever is open.
  useEffect(() => {
    function onKey(e) {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === 'c' || e.key === 'C') && canComment) {
        e.preventDefault();
        setMode((m) => !m);
        setDraft(null);
      } else if (e.key === 'Escape') {
        setMode(false);
        setDraft(null);
        setRepinning(null);
        setActiveId(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canComment]);

  // A notification link (?thread=<id>) opens that thread and brings it into view.
  const threadParam = params.get('thread');
  useEffect(() => {
    if (!threadParam || !api.loaded) return;
    const thread = threads.find((t) => t.id === threadParam);
    if (thread) {
      if (thread.resolvedAt) setShowResolved(true);
      setActiveId(thread.id);
      const point = flowPointOf(thread);
      if (point && flowRef.current) flowRef.current.setCenter(point.x, point.y, { zoom: viewport.zoom, duration: 300 });
      if (!point) setListOpen(true);
    }
    const next = new URLSearchParams(params);
    next.delete('thread');
    setParams(next, { replace: true });
  }, [threadParam, api.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  /** What the click landed on: a node (anchor it there) or empty canvas. */
  function anchorAt(e) {
    const rect = overlayRef.current.getBoundingClientRect();
    const local = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const flow = { x: (local.x - viewport.x) / viewport.zoom, y: (local.y - viewport.y) / viewport.zoom };
    const nodeEl = document.elementsFromPoint(e.clientX, e.clientY).map((el) => el.closest?.('.react-flow__node')).find(Boolean);
    const nodeId = nodeEl?.getAttribute('data-id');
    const anchor = nodeId && nodesById.has(nodeId) ? { type: 'node', nodeId } : { type: 'canvas', x: Math.round(flow.x), y: Math.round(flow.y) };
    return { anchor, flow, screen: { left: local.x, top: local.y } };
  }

  async function onPlace(e) {
    e.preventDefault();
    e.stopPropagation();
    const spot = anchorAt(e);
    if (repinning) {
      const thread = repinning;
      setRepinning(null);
      try {
        api.upsertThread(await repinThread(thread.id, spot.anchor));
        setActiveId(thread.id);
      } catch (err) {
        useToastStore.getState().push(err?.response?.data?.error || 'Could not re-pin the thread', 'error');
      }
      return;
    }
    setActiveId(null);
    setDraft(spot);
  }

  async function submitDraft(body) {
    const { anchor, flow } = draft;
    let thread;
    try {
      thread = await createThread(workflowId, { anchor, body });
    } catch (err) {
      // The node was deleted by a collaborator a moment ago: keep the words,
      // pin them to the same spot on the canvas instead (spec/29 edge cases).
      if (err?.response?.status === 409 && err.response.data?.code === 'node_missing') {
        thread = await createThread(workflowId, { anchor: { type: 'canvas', x: Math.round(flow.x), y: Math.round(flow.y) }, body });
        useToastStore.getState().push('That node was just deleted — your comment is pinned to the canvas instead.', 'info');
      } else {
        throw err;
      }
    }
    api.upsertThread(thread);
    setDraft(null);
    setMode(false);
    setActiveId(thread.id);
  }

  function openThread(thread) {
    if (thread.resolvedAt) setShowResolved(true);
    setActiveId(thread.id);
    const point = flowPointOf(thread);
    if (point && flowRef.current) flowRef.current.setCenter(point.x, point.y, { zoom: viewport.zoom, duration: 300 });
  }

  const pinned = threads
    .filter((t) => showResolved || !t.resolvedAt)
    .map((t) => ({ thread: t, point: flowPointOf(t) }))
    .filter((p) => p.point);
  const active = threads.find((t) => t.id === activeId) || null;
  const activePoint = active && flowPointOf(active);
  const clampLeft = (left) => Math.max(8, Math.min(left, (width || 1200) - POPOVER_WIDTH));
  const openCount = threads.filter((t) => !t.resolvedAt).length;
  const placing = mode || Boolean(repinning);

  // One compact segmented group. The Builder hands in a slot in its toolbar
  // (spec/36) so these never float over the canvas or the config panel; without
  // a slot they sit in the canvas's top-right corner as before.
  const segment = 'flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition';
  const controls = (
    <div className="pointer-events-auto flex items-center divide-x divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white/90 shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900/90">
      {canComment && (
        <button
          type="button"
          data-testid="comment-mode"
          onClick={() => { setMode((m) => !m); setDraft(null); setRepinning(null); }}
          title="Comment mode (C): click a node or an empty spot to start a thread"
          aria-pressed={mode}
          className={`${segment} ${mode ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}
        >
          💬 <span className="hidden xl:inline">Comment</span>
        </button>
      )}
      <button
        type="button"
        data-testid="thread-list-toggle"
        onClick={() => setListOpen((v) => !v)}
        title="All comment threads on this workflow"
        aria-pressed={listOpen}
        className={`${segment} ${listOpen ? 'bg-slate-100 dark:bg-slate-800' : ''} text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800`}
      >
        Threads{openCount ? ` · ${openCount}` : ''}
      </button>
      <label className={`${segment} cursor-pointer text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800`} title="Show resolved threads on the canvas">
        <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
        Resolved
      </label>
    </div>
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      {controlsTarget
        ? createPortal(controls, controlsTarget)
        : <div className="absolute right-4 top-14">{controls}</div>}

      {placing && (
        <div
          ref={overlayRef}
          data-testid="comment-overlay"
          onClick={onPlace}
          className="pointer-events-auto absolute inset-0 cursor-crosshair"
        >
          <span className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-slate-900/80 px-3 py-1 text-xs text-white">
            {repinning ? 'Click where this thread should live' : 'Click a node or an empty spot to comment · Esc to cancel'}
          </span>
        </div>
      )}
      {!placing && <div ref={overlayRef} className="absolute inset-0" />}

      {pinned.map(({ thread, point }) => {
        const s = toScreen(point);
        const resolved = Boolean(thread.resolvedAt);
        return (
          <button
            key={thread.id}
            type="button"
            data-testid="comment-pin"
            data-thread-id={thread.id}
            onClick={(e) => { e.stopPropagation(); setActiveId(thread.id === activeId ? null : thread.id); setDraft(null); }}
            style={{ left: s.left - 12, top: s.top - 12 }}
            title={`${thread.comments[0]?.author?.name || ''}: ${thread.replyCount} repl${thread.replyCount === 1 ? 'y' : 'ies'}`}
            className={`pointer-events-auto absolute flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full rounded-bl-none border-2 border-white px-1 text-[10px] font-bold text-white shadow-md ${
              resolved ? 'bg-slate-400' : 'bg-brand-600'
            } ${thread.id === activeId ? 'ring-2 ring-brand-300' : ''}`}
          >
            {(thread.comments[0]?.author?.name || '?').slice(0, 1).toUpperCase()}
            {thread.replyCount > 0 && <span className="font-medium">{thread.replyCount}</span>}
          </button>
        );
      })}

      {draft && (
        <div
          className="pointer-events-auto absolute z-30 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          style={{ left: clampLeft(draft.screen.left + 12), top: Math.max(8, draft.screen.top - 8) }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">
            {draft.anchor.type === 'node' ? `New thread on ${draft.anchor.nodeId}` : 'New thread on the canvas'}
          </p>
          <MentionComposer onSubmit={submitDraft} onCancel={() => setDraft(null)} />
        </div>
      )}

      {active && (
        <ThreadPopover
          key={active.id}
          thread={active}
          api={api}
          onClose={() => setActiveId(null)}
          style={activePoint
            ? { left: clampLeft(toScreen(activePoint).left + 16), top: Math.max(8, toScreen(activePoint).top - 8) }
            : { right: 344, top: 64 }}
        />
      )}

      {listOpen && (
        <ThreadListPanel
          threads={threads}
          onOpen={openThread}
          onRepin={(t) => { setRepinning(t); setMode(false); setListOpen(false); }}
          onClose={() => setListOpen(false)}
        />
      )}
    </div>
  );
}

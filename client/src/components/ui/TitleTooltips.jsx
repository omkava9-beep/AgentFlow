import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * App-wide upgrade of native `title=` tooltips to the kit's tooltip style: on
 * hover or keyboard focus of any element with a `title`, the attribute is
 * parked (so the OS tooltip never appears) and a styled one is shown; it's
 * restored when the pointer leaves, so the DOM keeps its meaning.
 *
 * New code should use <Tooltip> directly; this is the safety net for the
 * `title=` attributes that already exist across pages. Mounted once at the root.
 */
export default function TitleTooltips({ delay = 400 }) {
  const [tip, setTip] = useState(null);
  const current = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    function restore() {
      clearTimeout(timer.current);
      const el = current.current;
      if (el && el.dataset.afTitle !== undefined) {
        el.setAttribute('title', el.dataset.afTitle);
        delete el.dataset.afTitle;
      }
      current.current = null;
      setTip(null);
    }

    function enter(e) {
      const el = e.target?.closest?.('[title]');
      if (!el || el === current.current) return;
      const text = el.getAttribute('title');
      if (!text) return;
      restore();
      current.current = el;
      el.dataset.afTitle = text;
      el.removeAttribute('title');
      timer.current = setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 44;
        setTip({ text, x: Math.min(Math.max(r.left + r.width / 2, 12), window.innerWidth - 12), y: below ? r.bottom + 6 : r.top - 6, below });
      }, e.type === 'focusin' ? 0 : delay);
    }

    function leave(e) {
      const el = current.current;
      if (!el) return;
      const to = e.relatedTarget;
      if (to && el.contains(to)) return;
      restore();
    }

    document.addEventListener('pointerover', enter, true);
    document.addEventListener('pointerout', leave, true);
    document.addEventListener('focusin', enter, true);
    document.addEventListener('focusout', leave, true);
    document.addEventListener('pointerdown', restore, true);
    window.addEventListener('scroll', restore, true);
    return () => {
      restore();
      document.removeEventListener('pointerover', enter, true);
      document.removeEventListener('pointerout', leave, true);
      document.removeEventListener('focusin', enter, true);
      document.removeEventListener('focusout', leave, true);
      document.removeEventListener('pointerdown', restore, true);
      window.removeEventListener('scroll', restore, true);
    };
  }, [delay]);

  if (!tip) return null;
  return createPortal(
    <div
      role="tooltip"
      style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})` }}
      className="pointer-events-none fixed z-[100] max-w-xs animate-fade-in rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium leading-snug text-zinc-50 shadow-popover dark:bg-zinc-100 dark:text-zinc-900"
    >
      {tip.text}
    </div>,
    document.body,
  );
}

import { cloneElement, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Lightweight hover/focus tooltip rendered in a portal so it's never clipped by
 * an overflow container (toolbars, panels). `side` is a preference; it flips
 * below when there's no room above.
 */
export default function Tooltip({ content, children, side = 'top', delay = 350 }) {
  const id = useId();
  const [pos, setPos] = useState(null);
  const timer = useRef(null);
  if (!content) return children;

  function show(e) {
    const el = e.currentTarget;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect();
      if (side === 'right') {
        setPos({ x: r.right + 8, y: r.top + r.height / 2, placement: 'right' });
        return;
      }
      const above = side === 'top' && r.top > 40;
      setPos({ x: r.left + r.width / 2, y: above ? r.top - 6 : r.bottom + 6, placement: above ? 'top' : 'bottom' });
    }, delay);
  }
  function hide() {
    clearTimeout(timer.current);
    setPos(null);
  }

  const child = cloneElement(children, {
    'aria-describedby': pos ? id : undefined,
    onMouseEnter: (e) => { children.props.onMouseEnter?.(e); show(e); },
    onMouseLeave: (e) => { children.props.onMouseLeave?.(e); hide(); },
    onFocus: (e) => { children.props.onFocus?.(e); show(e); },
    onBlur: (e) => { children.props.onBlur?.(e); hide(); },
    onMouseDown: (e) => { children.props.onMouseDown?.(e); hide(); },
  });

  return (
    <>
      {child}
      {pos && createPortal(
        <div
          id={id}
          role="tooltip"
          style={{ left: pos.x, top: pos.y, transform: pos.placement === 'right' ? 'translate(0, -50%)' : `translate(-50%, ${pos.placement === 'top' ? '-100%' : '0'})` }}
          className="pointer-events-none fixed z-[100] max-w-xs animate-fade-in rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-50 shadow-popover dark:bg-zinc-100 dark:text-zinc-900"
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}

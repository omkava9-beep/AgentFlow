import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import { confirm } from '../components/ui/confirm';

/**
 * Losing an unsaved graph to a stray back-button press is the most expensive
 * mistake the builder allows, so guard both exits: `beforeunload` covers reload
 * and tab close, `useBlocker` covers in-app navigation.
 *
 * Since spec/28 edits save themselves, so the Builder passes `true` only while
 * there are ops the server hasn't acknowledged yet - closing a tab with nothing
 * pending doesn't warn.
 */
export function useUnsavedChangesGuard(dirty, message) {
  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      // Browsers show their own generic text; assigning returnValue is what
      // actually triggers the prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Keyed on the state alone: the Builder re-renders constantly (presence,
  // cursors), and the dialog must open once per blocked navigation.
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    // The shared ConfirmDialog (spec/36), not window.confirm; the blocker simply
    // stays 'blocked' until it's answered.
    confirm({ title: 'Leave this page?', body: message, confirmLabel: 'Leave anyway', cancelLabel: 'Stay', destructive: true })
      .then((ok) => {
        const current = blockerRef.current;
        if (current.state !== 'blocked') return;
        if (ok) current.proceed();
        else current.reset();
      });
  }, [blocker.state, message]);
}

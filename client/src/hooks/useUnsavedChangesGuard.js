import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Losing an unsaved graph to a stray back-button press is the most expensive
 * mistake the builder allows, so guard both exits: `beforeunload` covers reload
 * and tab close, `useBlocker` covers in-app navigation.
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

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    // eslint-disable-next-line no-alert
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);
}

/**
 * Lets non-React code (the API client's interceptors) navigate through the data
 * router instead of a full page reload, so in-memory state like toasts survives.
 * The Root route registers the router's navigate function on mount.
 */
let navigateFn = null;

export function setNavigate(fn) {
  navigateFn = fn;
}

export function navigateTo(path) {
  if (navigateFn) navigateFn(path, { replace: true });
  else window.location.assign(path);
}

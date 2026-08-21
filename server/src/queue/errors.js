/**
 * A failure that will never succeed on retry — malformed input, an unknown tool
 * type, a config error. The queue rejects these immediately instead of burning
 * every attempt on work that cannot possibly pass.
 *
 * Duck-typed via `permanent` rather than `instanceof` so tool handlers can flag
 * their own error types without importing the queue.
 */
export class PermanentFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentFailure';
    this.permanent = true;
  }
}

export function isPermanent(err) {
  return err?.permanent === true;
}

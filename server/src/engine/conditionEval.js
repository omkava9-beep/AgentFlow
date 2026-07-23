/** Evaluates a small, sandboxed boolean expression against `output` only. */
export function evaluateCondition(expression, output) {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('output', `"use strict"; return Boolean(${expression});`);
    return Boolean(fn(output));
  } catch {
    return false;
  }
}

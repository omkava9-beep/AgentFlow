/**
 * Subsequence fuzzy match for the command palette: every query character must
 * appear in order. Higher is better; -1 means no match. Contiguous runs and
 * word-start hits score extra, so "set mem" ranks "Settings · Members" first.
 */
export function fuzzyScore(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    score += 1;
    if (found === prev + 1) score += 2;
    if (found === 0 || /[\s·/-]/.test(t[found - 1])) score += 3;
    prev = found;
    ti = found + 1;
  }
  // Shorter labels win ties.
  return score - t.length * 0.01;
}

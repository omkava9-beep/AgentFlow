export function initialsOf(nameOrEmail = '?') {
  const parts = String(nameOrEmail).trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}


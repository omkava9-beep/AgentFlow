import { verifyToken } from '../utils/jwt.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
  try {
    req.userId = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
}

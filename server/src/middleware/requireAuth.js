import { authenticateToken } from '../utils/jwt.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
  try {
    const { userId, tokenVersion } = await authenticateToken(token);
    req.userId = userId;
    req.tokenVersion = tokenVersion;
    next();
  } catch {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
}

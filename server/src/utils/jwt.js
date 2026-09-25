import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import User from '../models/User.js';

const EXPIRY = '7d';

/**
 * `tv` is the user's tokenVersion at signing time (spec/36 §4). Bumping the
 * version on the User (password change, "sign out everywhere else") makes every
 * older token fail `authenticateToken` on its next use.
 */
export function signToken(userId, tokenVersion = 0) {
  return jwt.sign({ sub: String(userId), tv: tokenVersion }, env.jwtSecret, { expiresIn: EXPIRY });
}

export function verifyToken(token) {
  const payload = jwt.verify(token, env.jwtSecret);
  return payload.sub;
}

/**
 * Signature + expiry + tokenVersion. Throws on any failure. A token issued
 * before tokenVersion existed carries no `tv` and counts as version 0, so
 * phase-2 sessions keep working until the first password change.
 *
 * One user read per request: negligible here, and requireWorkspace already
 * reads the membership on every tenant request (spec/22).
 */
export async function authenticateToken(token) {
  const payload = jwt.verify(token, env.jwtSecret);
  const user = await User.findById(payload.sub).select('tokenVersion').lean();
  if (!user) throw new Error('unknown user');
  if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) throw new Error('stale token');
  return { userId: String(payload.sub), exp: payload.exp ? payload.exp * 1000 : null, tokenVersion: user.tokenVersion ?? 0 };
}

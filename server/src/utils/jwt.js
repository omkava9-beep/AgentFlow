import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const EXPIRY = '7d';

export function signToken(userId) {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: EXPIRY });
}

export function verifyToken(token) {
  const payload = jwt.verify(token, env.jwtSecret);
  return payload.sub;
}

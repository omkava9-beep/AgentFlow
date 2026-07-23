import crypto from 'node:crypto';

export function generateToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

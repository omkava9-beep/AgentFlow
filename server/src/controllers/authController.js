import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { signToken } from '../utils/jwt.js';
import { HttpError } from '../middleware/errorHandler.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toPublicUser(user) {
  return { id: user._id.toString(), email: user.email };
}

export async function register(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email is required');
    if (!password || password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) throw new HttpError(409, 'An account with this email already exists');

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email: email.toLowerCase(), passwordHash });
    const token = signToken(user._id.toString());
    res.status(201).json({ token, user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = email && await User.findOne({ email: email.toLowerCase() });
    const valid = user && await bcrypt.compare(password || '', user.passwordHash);
    if (!valid) throw new HttpError(401, 'Invalid email or password');

    const token = signToken(user._id.toString());
    res.json({ token, user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    const user = await User.findById(req.userId);
    if (!user) throw new HttpError(401, 'Missing or invalid token');
    res.json(toPublicUser(user));
  } catch (err) {
    next(err);
  }
}

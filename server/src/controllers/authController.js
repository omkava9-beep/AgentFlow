import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { signToken } from '../utils/jwt.js';
import { HttpError } from '../middleware/errorHandler.js';
import { createPersonalWorkspace, listWorkspacesForUser } from '../services/workspaceService.js';
import { audit } from '../services/audit.js';
import { isOperator } from './statusController.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toPublicUser(user) {
  return { id: user._id.toString(), email: user.email, name: user.name || user.email.split('@')[0] };
}

export async function register(req, res, next) {
  try {
    const { email, password, name } = req.body;
    if (!email || !EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email is required');
    if (!password || password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');

    const normalizedEmail = email.toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) throw new HttpError(409, 'An account with this email already exists');

    const passwordHash = await bcrypt.hash(password, 10);
    const displayName = (typeof name === 'string' && name.trim()) || normalizedEmail.split('@')[0];
    const user = await User.create({ email: normalizedEmail, name: displayName, passwordHash });

    // A user with no workspace can't do anything and can't fix it from the UI,
    // so registration is all-or-nothing (spec/22 §1).
    let personal;
    try {
      personal = await createPersonalWorkspace(user);
    } catch (err) {
      await User.deleteOne({ _id: user._id });
      throw err;
    }
    await audit({ userId: user._id, ip: req.ip }, 'workspace.created',
      { type: 'workspace', id: personal.workspace._id, name: personal.workspace.name }, { meta: { personal: true } });

    const token = signToken(user._id, user.tokenVersion ?? 0);
    res.status(201).json({ token, user: toPublicUser(user), workspaces: await listWorkspacesForUser(user._id) });
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

    const token = signToken(user._id, user.tokenVersion ?? 0);
    res.json({ token, user: toPublicUser(user), workspaces: await listWorkspacesForUser(user._id) });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    const user = await User.findById(req.userId);
    if (!user) throw new HttpError(401, 'Missing or invalid token');
    // `operator` unlocks the cross-tenant status view (spec/36 §7).
    res.json({ ...toPublicUser(user), workspaces: await listWorkspacesForUser(user._id), operator: await isOperator(user._id) });
  } catch (err) {
    next(err);
  }
}

const MIN_PASSWORD = 6;
const MAX_NAME = 80;

/** Profile rename (spec/36 §4). The name shows in member lists, presence and comments. */
export async function updateMe(req, res, next) {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) throw new HttpError(400, 'Name is required');
    if (name.length > MAX_NAME) throw new HttpError(400, `Name must be at most ${MAX_NAME} characters`);
    const user = await User.findByIdAndUpdate(req.userId, { $set: { name } }, { returnDocument: 'after' });
    if (!user) throw new HttpError(401, 'Missing or invalid token');
    res.json(toPublicUser(user));
  } catch (err) {
    next(err);
  }
}

/**
 * Bumps tokenVersion, which invalidates every token the user holds, then hands
 * this session a fresh one so the caller stays signed in.
 */
async function rotateSessions(userId) {
  const user = await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } }, { returnDocument: 'after' });
  if (!user) throw new HttpError(401, 'Missing or invalid token');
  return signToken(user._id, user.tokenVersion);
}

/** Change password (spec/36 §4): other sessions are signed out only on success. */
export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const user = await User.findById(req.userId);
    if (!user) throw new HttpError(401, 'Missing or invalid token');
    // Same generic phrasing as login: don't help someone guessing at an open session.
    const valid = await bcrypt.compare(currentPassword || '', user.passwordHash);
    if (!valid) throw new HttpError(400, 'Invalid email or password');
    if (!newPassword || newPassword.length < MIN_PASSWORD) {
      throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters`);
    }
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ token: await rotateSessions(user._id) });
  } catch (err) {
    next(err);
  }
}

/** "Sign out everywhere else" (spec/36 §4). */
export async function revokeSessions(req, res, next) {
  try {
    res.json({ token: await rotateSessions(req.userId) });
  } catch (err) {
    next(err);
  }
}

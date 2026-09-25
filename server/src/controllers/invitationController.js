import crypto from 'node:crypto';
import Invitation from '../models/Invitation.js';
import Membership from '../models/Membership.js';
import Workspace from '../models/Workspace.js';
import User from '../models/User.js';
import { HttpError } from '../middleware/errorHandler.js';
import { findInWorkspace, scopedFilter } from '../tenancy/scoped.js';
import { presentWorkspace } from '../services/workspaceService.js';
import { sendMail } from '../services/outbox.js';
import { notify } from '../services/notify.js';
import { env } from '../config/env.js';
import { planFor } from '../config/plans.js';
import { seatsUsed } from './billingController.js';
import { audit } from '../services/audit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_ROLES = ['admin', 'editor', 'viewer'];
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The token is a credential: only its hash is stored, and it's never logged. */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

// Built from CLIENT_ORIGIN like share links (spec/18): /invite/:token is a React page.
const inviteUrl = (token) => `${env.clientOrigin.replace(/\/+$/, '')}/invite/${token}`;

const isExpired = (inv) => inv.status === 'pending' && inv.expiresAt < new Date();

/** `expired` is derived on read and written back lazily - no sweeper job. */
async function settleExpiry(inv) {
  if (isExpired(inv)) {
    inv.status = 'expired';
    await inv.save();
  }
  return inv;
}

function present(inv, inviter) {
  return {
    id: inv._id.toString(),
    email: inv.email,
    role: inv.role,
    status: inv.status,
    invitedBy: inviter ? { id: inviter._id.toString(), name: inviter.name || '', email: inviter.email } : null,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
  };
}

/** Issues a fresh token on the invite, mails the link, and returns the plaintext URL once. */
async function issueAndMail(inv, { inviter, workspace }) {
  const token = newToken();
  inv.tokenHash = hashToken(token);
  inv.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  inv.status = 'pending';
  await inv.save();

  const url = inviteUrl(token);
  const who = inviter.name || inviter.email;
  await sendMail({
    to: inv.email,
    subject: `${who} invited you to ${workspace.name}`,
    text: `${who} invited you to join ${workspace.name} on AgentFlow as ${inv.role}.\n\nAccept the invitation: ${url}\n\nThis link expires in 7 days.`,
    kind: 'invite',
    workspaceId: workspace._id,
    meta: { inviteUrl: url, workspaceName: workspace.name, role: inv.role, invitedByName: who },
  });
  return url;
}

export async function list(req, res, next) {
  try {
    const invitations = await Invitation.find(scopedFilter(req, { status: { $in: ['pending', 'expired'] } }))
      .sort({ createdAt: -1 });
    for (const inv of invitations) await settleExpiry(inv);
    const inviters = await User.find({ _id: { $in: invitations.map((i) => i.invitedBy) } }).select('email name');
    const byId = new Map(inviters.map((u) => [u._id.toString(), u]));
    res.json(invitations.map((inv) => present(inv, byId.get(inv.invitedBy.toString()))));
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const role = req.body?.role;
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email is required');
    if (role === 'owner') throw new HttpError(400, "Nobody can be invited straight to owner - invite them, then promote them");
    if (!INVITE_ROLES.includes(role)) throw new HttpError(400, `Role must be one of: ${INVITE_ROLES.join(', ')}`);
    // Only owners can bring in admins (spec/23 §2).
    if (role === 'admin' && req.role !== 'owner') throw new HttpError(403, "You don't have permission to do that");

    const existingUser = await User.findOne({ email }).select('_id');
    if (existingUser && await Membership.exists({ workspaceId: req.workspace._id, userId: existingUser._id })) {
      throw new HttpError(409, 'Already a member');
    }

    const inviter = await User.findById(req.userId).select('email name');

    // At most one live invite per (workspace, email). Inviting the same address
    // again reuses it - but a usable link needs a plaintext token we don't have
    // (only the hash is stored), so the token and expiry rotate and the role is
    // updated to the latest request. The old link stops working.
    let inv = await Invitation.findOne(scopedFilter(req, { email, status: 'pending' }));
    if (inv) await settleExpiry(inv);
    const isNew = !inv || inv.status !== 'pending';
    if (isNew) {
      // Member limit (spec/33 §6): members plus pending invites, against the plan.
      // Only blocks new seats - a re-invite of a pending address takes none.
      const plan = planFor(req.workspace.plan);
      if (plan.members !== null && await seatsUsed(req) >= plan.members) {
        throw new HttpError(403, `The ${plan.name} plan allows ${plan.members} members`);
      }
      inv = new Invitation({ workspaceId: req.workspace._id, email, role, invitedBy: req.userId, tokenHash: 'pending', expiresAt: new Date() });
    } else {
      inv.role = role;
    }

    const url = await issueAndMail(inv, { inviter, workspace: req.workspace });
    // An invitee who already has an account also gets it on their bell (spec/29).
    // The one notification allowed to reach a non-member: they aren't one yet.
    if (existingUser) {
      await notify([existingUser._id], {
        workspaceId: req.workspace._id,
        kind: 'invite',
        title: `${inviter.name || inviter.email} invited you to ${req.workspace.name}`,
        body: `Join as ${inv.role}.`,
        link: new URL(url).pathname,
        actorId: req.userId,
        allowNonMember: true,
      });
    }
    // The token never goes near the log - only who was invited, and as what.
    await audit(req, 'member.invited', { type: 'invitation', id: inv._id, name: inv.email },
      { meta: { role: inv.role, ...(isNew ? {} : { reinvite: true }) } });
    res.status(isNew ? 201 : 200).json({ invitation: present(inv, inviter), inviteUrl: url });
  } catch (err) {
    next(err);
  }
}

export async function resend(req, res, next) {
  try {
    const inv = await findInWorkspace(Invitation, req.params.invId, req);
    if (!['pending', 'expired'].includes(inv.status)) throw new HttpError(404, 'Invitation not found');
    const inviter = await User.findById(req.userId).select('email name');
    const url = await issueAndMail(inv, { inviter, workspace: req.workspace });
    await audit(req, 'invitation.resent', { type: 'invitation', id: inv._id, name: inv.email }, { meta: { role: inv.role } });
    res.json({ invitation: present(inv, inviter), inviteUrl: url });
  } catch (err) {
    next(err);
  }
}

export async function revoke(req, res, next) {
  try {
    const inv = await findInWorkspace(Invitation, req.params.invId, req);
    if (!['pending', 'expired'].includes(inv.status)) throw new HttpError(404, 'Invitation not found');
    inv.status = 'revoked';
    await inv.save();
    await audit(req, 'invitation.revoked', { type: 'invitation', id: inv._id, name: inv.email }, { meta: { role: inv.role } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// --- public side: the invitee's link ----------------------------------------

/**
 * Revoked, accepted and unknown tokens are one 404 - don't confirm a link was
 * ever valid. Expired stays distinguishable so the page can say "ask for a new one".
 */
async function findByToken(token) {
  const inv = typeof token === 'string' && token ? await Invitation.findOne({ tokenHash: hashToken(token) }) : null;
  if (!inv || !['pending', 'expired'].includes(inv.status)) throw new HttpError(404, 'This invitation is no longer valid');
  const workspace = await Workspace.findById(inv.workspaceId);
  if (!workspace) throw new HttpError(404, 'This invitation is no longer valid');
  return { inv: await settleExpiry(inv), workspace };
}

/** Unauthenticated: only what the invite page needs to render. */
export async function getByToken(req, res, next) {
  try {
    const { inv, workspace } = await findByToken(req.params.token);
    const inviter = await User.findById(inv.invitedBy).select('email name');
    res.json({
      workspaceName: workspace.name,
      invitedByName: inviter ? (inviter.name || inviter.email) : 'Someone',
      email: inv.email,
      role: inv.role,
      status: inv.status,
    });
  } catch (err) {
    next(err);
  }
}

export async function accept(req, res, next) {
  try {
    const { inv, workspace } = await findByToken(req.params.token);
    if (inv.status === 'expired') throw new HttpError(410, 'This invitation has expired - ask for a new one');

    // The signed-in account must be the invited address, so a forwarded link
    // can't be redeemed by someone else. The invitee already knows the address.
    const user = await User.findById(req.userId).select('email');
    if (!user) throw new HttpError(401, 'Missing or invalid token');
    if (user.email !== inv.email) {
      throw new HttpError(403, `This invite was sent to ${inv.email} - sign in with that account to accept it`);
    }

    let membership = await Membership.findOne({ workspaceId: workspace._id, userId: user._id });
    if (!membership) {
      try {
        membership = await Membership.create({ workspaceId: workspace._id, userId: user._id, role: inv.role });
      } catch (err) {
        // Two accepts racing: the unique index lets exactly one create through.
        if (err?.code !== 11000) throw err;
        membership = await Membership.findOne({ workspaceId: workspace._id, userId: user._id });
      }
    }
    // Already a member: accepting just closes the invite; the existing role stands.

    inv.status = 'accepted';
    inv.acceptedBy = user._id;
    await inv.save();
    // A public route: no requireWorkspace, so the workspace is named explicitly.
    await audit(req, 'invitation.accepted', { type: 'invitation', id: inv._id, name: inv.email },
      { workspaceId: workspace._id, meta: { role: membership.role } });

    res.json({ workspace: presentWorkspace(workspace, membership) });
  } catch (err) {
    next(err);
  }
}

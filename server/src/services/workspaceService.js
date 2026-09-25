import crypto from 'node:crypto';
import Workspace from '../models/Workspace.js';
import Membership from '../models/Membership.js';
import { HttpError } from '../middleware/errorHandler.js';
import { permissionsFor } from '../tenancy/permissions.js';

// Top-level client route segments and API prefixes a slug must never shadow.
export const RESERVED_SLUGS = new Set([
  'api', 'w', 'new', 'settings', 'admin', 'login', 'register', 'invite', 'shared', 'outbox',
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** Returns an error message, or null when the slug is acceptable. */
export function slugProblem(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    return 'Slug must be 3-40 characters of lowercase letters, digits and hyphens, without a leading or trailing hyphen';
  }
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is reserved`;
  return null;
}

function slugify(name) {
  const base = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 35)
    .replace(/-+$/g, '');
  if (!base) return 'workspace';
  return base.length >= 3 && !RESERVED_SLUGS.has(base) ? base : `${base}-ws`;
}

const suffix = () => crypto.randomBytes(3).toString('hex').slice(0, 4);
const isDuplicateKey = (err) => err?.code === 11000;

export function presentWorkspace(workspace, membership) {
  return {
    id: workspace._id.toString(),
    name: workspace.name,
    slug: workspace.slug,
    personal: workspace.personal,
    plan: workspace.plan,
    createdBy: workspace.createdBy ? workspace.createdBy.toString() : null,
    settings: { publicSharing: workspace.settings?.publicSharing !== false },
    role: membership.role,
    permissions: permissionsFor(membership.role),
  };
}

/**
 * Creates a workspace and its owner membership. The slug is generated from the
 * name; a collision (checked up front, and again by the unique index when two
 * creates race) retries with a random 4-character suffix.
 */
export async function createWorkspace({ name, userId, personal = false }) {
  const cleanName = String(name || '').trim() || 'Untitled workspace';
  const base = slugify(cleanName);

  let workspace = null;
  for (let attempt = 0; attempt < 6 && !workspace; attempt += 1) {
    const slug = attempt === 0 ? base : `${base.slice(0, 35)}-${suffix()}`;
    if (attempt === 0 && await Workspace.exists({ slug })) continue;
    try {
      workspace = await Workspace.create({ name: cleanName, slug, personal, createdBy: userId });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
  }
  if (!workspace) throw new HttpError(409, 'Could not allocate a unique workspace slug');

  try {
    const membership = await Membership.create({ workspaceId: workspace._id, userId, role: 'owner' });
    return { workspace, membership };
  } catch (err) {
    // A workspace with no owner is unreachable - don't leave one behind.
    await Workspace.deleteOne({ _id: workspace._id });
    throw err;
  }
}

export function createPersonalWorkspace(user) {
  const who = user.name || user.email.split('@')[0];
  return createWorkspace({ name: `${who}'s workspace`, userId: user._id, personal: true });
}

export async function listWorkspacesForUser(userId) {
  const memberships = await Membership.find({ userId });
  const workspaces = await Workspace.find({ _id: { $in: memberships.map((m) => m.workspaceId) } });
  const byId = new Map(workspaces.map((w) => [w._id.toString(), w]));
  return memberships
    .map((m) => byId.get(m.workspaceId.toString()) && presentWorkspace(byId.get(m.workspaceId.toString()), m))
    .filter(Boolean)
    // Personal first, then alphabetical: a stable order for the switcher.
    .sort((a, b) => (b.personal - a.personal) || a.name.localeCompare(b.name));
}

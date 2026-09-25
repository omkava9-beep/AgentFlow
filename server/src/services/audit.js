import AuditEvent from '../models/AuditEvent.js';
import User from '../models/User.js';
import { redactKnownSecretFields } from '../secrets/redact.js';

/**
 * The one way anything is written to the audit log (spec/34 §2).
 *
 *   audit(req, 'member.role_changed', { type: 'member', id, name: 'bob@acme.test' },
 *         { before: { role: 'editor' }, after: { role: 'viewer' } })
 *
 * Called *after* the mutation succeeds. It never throws: a standalone MongoDB
 * has no transactions, so failing a request whose change is already committed
 * would leave the client confused and the log no more complete. A failed insert
 * is logged loudly instead.
 */

const MAX_STRING = 500;

function truncate(value) {
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (Array.isArray(value)) return value.map(truncate);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncate(v)]));
  }
  return value;
}

/**
 * spec/34 §3: secret-named keys and token-looking values become "[redacted]" at
 * any depth (so an entry still shows that a field changed, just not to what),
 * plus any fields an integration's auth schema marks `secret: true`, and long
 * strings are cut to 500 characters.
 */
export function redact(obj, secretKeys = []) {
  if (obj === null || obj === undefined) return null;
  return truncate(redactKnownSecretFields(obj, secretKeys));
}

const quote = (label) => (label ? `"${label}"` : 'an item');

// Human sentences built at write time, so the list renders without joins and
// stays readable after the people or things it names are gone.
const SUMMARIES = {
  'workspace.created': (a, t) => `${a} created workspace ${quote(t)}`,
  'workspace.updated': (a, t, d) => `${a} updated ${Object.keys(d.after || {}).join(', ') || 'settings'} of workspace ${quote(t)}`,
  'workspace.deleted': (a, t) => `${a} deleted workspace ${quote(t)}`,
  'workspace.plan_changed': (a, t, d) => `${a} changed the plan of ${quote(t)} from ${d.before?.plan ?? '?'} to ${d.after?.plan ?? '?'}`,
  'member.invited': (a, t, d) => `${a} invited ${t} as ${d.meta?.role ?? 'a member'}`,
  'invitation.resent': (a, t) => `${a} resent the invitation to ${t}`,
  'invitation.revoked': (a, t) => `${a} revoked the invitation to ${t}`,
  'invitation.accepted': (a, t, d) => `${a} accepted the invitation and joined as ${d.meta?.role ?? 'a member'}`,
  'member.role_changed': (a, t, d) => `${a} changed ${t}'s role from ${d.before?.role ?? '?'} to ${d.after?.role ?? '?'}`,
  'member.removed': (a, t) => `${a} removed ${t} from the workspace`,
  'member.left': (a) => `${a} left the workspace`,
  'apikey.created': (a, t) => `${a} created API key ${quote(t)}`,
  'apikey.revoked': (a, t) => `${a} revoked API key ${quote(t)}`,
  'connection.created': (a, t) => `${a} created connection ${quote(t)}`,
  'connection.updated': (a, t) => `${a} updated connection ${quote(t)}`,
  'connection.deleted': (a, t) => `${a} deleted connection ${quote(t)}`,
  'connection.tested': (a, t, d) => `${a} tested connection ${quote(t)}${d.meta?.status ? ` (${d.meta.status})` : ''}`,
  'workflow.deleted': (a, t) => `${a} deleted workflow ${quote(t)}`,
  'workflow.published': (a, t, d) => `${a} published ${quote(t)}${d.meta?.version ? ` as v${d.meta.version}` : ''}`,
  'workflow.restored': (a, t, d) => `${a} restored ${quote(t)}${d.meta?.version ? ` to v${d.meta.version}` : ''}`,
  'share.enabled': (a, t) => `${a} created a share link for ${quote(t)}`,
  'share.disabled': (a, t) => `${a} revoked the share link for ${quote(t)}`,
  'share.disabled_workspace': (a, t, d) => `${a} turned off public sharing${d.meta?.count ? ` (${d.meta.count} link${d.meta.count === 1 ? '' : 's'} revoked)` : ''}`,
  'trigger.updated': (a, t, d) => `${a} updated the ${d.meta?.kind ? `${d.meta.kind} ` : ''}trigger on ${quote(t)}`,
  'webhook.regenerated': (a, t) => `${a} regenerated the webhook URL for ${quote(t)}`,
  'template.deleted': (a, t) => `${a} deleted template ${quote(t)}`,
};

function summarize(action, actorLabel, targetLabel, details) {
  const build = SUMMARIES[action];
  return build ? build(actorLabel, targetLabel, details) : `${actorLabel} ${action} ${targetLabel || ''}`.trim();
}

/** Who did it: an API key (public API calls), else the signed-in user. */
async function resolveActor(req) {
  if (req?.apiKey) {
    return { actorType: 'apiKey', actorId: req.apiKey._id, actorLabel: `API key "${req.apiKey.name}" (${req.apiKey.prefix}…)` };
  }
  if (req?.userId) {
    // An email snapshot, so the entry still reads correctly after they leave.
    const user = await User.findById(req.userId).select('email').lean();
    return { actorType: 'user', actorId: req.userId, actorLabel: user?.email || 'unknown user' };
  }
  return { actorType: 'system', actorId: null, actorLabel: 'system' };
}

async function write(actor, workspaceId, action, target = {}, details = {}, ip = null) {
  try {
    if (!workspaceId) throw new Error('no workspaceId');
    const targetLabel = target.name ?? '';
    const secretKeys = details.secretKeys || [];
    await AuditEvent.create({
      workspaceId,
      ...actor,
      action,
      targetType: target.type,
      targetId: target.id ?? null,
      targetLabel,
      summary: details.summary || summarize(action, actor.actorLabel, targetLabel, details),
      before: redact(details.before, secretKeys),
      after: redact(details.after, secretKeys),
      meta: redact(details.meta, secretKeys),
      ip,
    });
  } catch (err) {
    console.error(`[audit] FAILED to record ${action} on ${target?.type}:${target?.id ?? '-'}: ${err.message}`);
  }
}

export async function audit(req, action, target, details = {}) {
  try {
    const actor = await resolveActor(req);
    const workspaceId = details.workspaceId || req?.workspaceId || (target?.type === 'workspace' ? target.id : null);
    await write(actor, workspaceId, action, target, details, req?.ip ?? null);
  } catch (err) {
    console.error(`[audit] FAILED to record ${action}: ${err.message}`);
  }
}

/** For actions with no request: `details.system` is 'migration' | 'scheduler' | 'seed'. */
export async function auditSystem(workspaceId, action, target, details = {}) {
  const actor = { actorType: 'system', actorId: null, actorLabel: details.system || 'system' };
  await write(actor, workspaceId, action, target, details, null);
}

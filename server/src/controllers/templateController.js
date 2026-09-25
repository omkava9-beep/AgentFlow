import Template from '../models/Template.js';
import Workflow from '../models/Workflow.js';
import User from '../models/User.js';
import { hub } from '../collab/hub.js';
import { HttpError } from '../middleware/errorHandler.js';
import { findInWorkspace, createInWorkspace, isValidObjectId, scopedFilter } from '../tenancy/scoped.js';
import { findCycle } from '../engine/topologicalOrder.js';
import { normalizeNodes } from '../integrations/normalizeToolConfig.js';
import { stripConnectionIds } from '../services/connectionService.js';
import { audit } from '../services/audit.js';
import { publish } from '../services/versionService.js';
import { checkCodeAuthorship } from '../engine/validateNodes.js';
import { isValidCron } from '../scheduler/index.js';
import { COMPANION_PREFIX, integrationsUsed } from '../templates/catalog.js';

/** Deep copy so a template and its clones can never share nested config objects. */
const snapshot = (value) => JSON.parse(JSON.stringify(value ?? []));

/**
 * The one place templates widen past the workspace: built-ins (workspaceId: null)
 * are visible everywhere, alongside this workspace's own. Overriding the scoped
 * filter's workspaceId keeps that widening explicit at each call site.
 */
const builtInOrOwn = (req) => ({ workspaceId: { $in: [null, req.workspaceId] } });

function present(template, userId, names = new Map()) {
  return {
    _id: template._id,
    name: template.name,
    description: template.description,
    nodes: template.nodes,
    edges: template.edges,
    nodeCount: template.nodes?.length || 0,
    edgeCount: template.edges?.length || 0,
    // Gallery metadata (built-ins; empty for a workspace's own templates).
    key: template.key ?? null,
    category: template.category ?? null,
    tags: template.tags || [],
    icon: template.icon ?? null,
    summary: template.summary || template.description || '',
    useCase: template.useCase || '',
    requiredIntegrations: template.requiredIntegrations?.length ? template.requiredIntegrations : integrationsUsed(template.nodes),
    integrationsUsed: integrationsUsed(template.nodes),
    triggerType: template.triggerType ?? template.trigger?.type ?? null,
    trigger: template.trigger ?? null,
    sampleInput: template.sampleInput ?? null,
    difficulty: template.difficulty ?? null,
    estimatedSetupMinutes: template.estimatedSetupMinutes ?? null,
    companion: Boolean(template.companion),
    companions: template.companions || [],
    // "Use template" needs code:author when the graph (or a companion's) has a Code node.
    usesCode: Boolean(template.usesCode ?? (template.nodes || []).some((n) => n.type === 'code')),
    order: template.order ?? null,
    builtIn: template.workspaceId === null || template.workspaceId === undefined,
    mine: Boolean(template.createdBy && userId && String(template.createdBy) === String(userId)),
    createdBy: template.createdBy ?? null,
    // "by Bob · 3 days ago" (spec/36 §5).
    createdByName: template.createdBy ? names.get(String(template.createdBy)) || null : null,
    createdAt: template.createdAt,
  };
}

export async function list(req, res, next) {
  try {
    // Built-ins (workspaceId: null) plus this workspace's - shared with teammates,
    // never another workspace's.
    const templates = await Template.find(scopedFilter(req, builtInOrOwn(req))).sort({
      workspaceId: 1,
      // Built-ins in catalogue order (companions last), then newest first.
      order: 1,
      createdAt: -1,
    });
    await markCompanionCode(req, templates);
    const creatorIds = [...new Set(templates.map((t) => t.createdBy).filter(Boolean).map(String))];
    const users = creatorIds.length ? await User.find({ _id: { $in: creatorIds } }).select('name email').lean() : [];
    const names = new Map(users.map((u) => [String(u._id), u.name || u.email.split('@')[0]]));
    res.json(templates.map((t) => present(t, req.userId, names)));
  } catch (err) {
    next(err);
  }
}

/** A template "uses code" if it or any companion it creates has a Code node. */
async function markCompanionCode(req, templates) {
  const byKey = new Map(templates.filter((t) => t.key).map((t) => [t.key, t]));
  for (const t of templates) {
    const own = (t.nodes || []).some((n) => n.type === 'code');
    const viaCompanion = (t.companions || []).some((key) => (byKey.get(key)?.nodes || []).some((n) => n.type === 'code'));
    t.usesCode = own || viaCompanion;
  }
}

async function findUsable(req, filter) {
  return Template.findOne(scopedFilter(req, { ...filter, ...builtInOrOwn(req) }));
}

export async function getTemplate(req, res, next) {
  try {
    const template = isValidObjectId(req.params.id) ? await findUsable(req, { _id: req.params.id }) : null;
    if (!template) throw new HttpError(404, 'Template not found');
    const companions = template.companions?.length
      ? await Template.find(scopedFilter(req, { key: { $in: template.companions }, ...builtInOrOwn(req) }))
      : [];
    await markCompanionCode(req, [template, ...companions]);
    res.json({
      ...present(template, req.userId),
      companionTemplates: companions.map((c) => ({ _id: c._id, key: c.key, name: c.name, summary: c.summary, nodeCount: c.nodes?.length || 0 })),
    });
  } catch (err) {
    next(err);
  }
}

export async function createFromWorkflow(req, res, next) {
  try {
    const { workflowId, name, description } = req.body || {};
    if (!workflowId) throw new HttpError(400, 'workflowId is required');

    // The template snapshots the draft as collaborators see it now (spec/28 §9):
    // flush the hub first, so the read below is current.
    await hub.flushBeforeRead(workflowId);
    const workflow = await findInWorkspace(Workflow, workflowId, req);
    const trimmed = String(name || '').trim() || `${workflow.name} template`;

    const template = await createInWorkspace(Template, req, {
      name: trimmed,
      description: String(description || '').trim(),
      // A snapshot, not a reference: later edits to the workflow must not follow
      // through into the template.
      // Connections belong to one workspace (spec/25); a template is shareable,
      // so it carries the node shape without the connection reference.
      nodes: stripConnectionIds(normalizeNodes(snapshot(workflow.nodes)).nodes),
      edges: snapshot(workflow.edges),
    });

    res.status(201).json(present(template, req.userId));
  } catch (err) {
    next(err);
  }
}

/** A template's graph as a fresh, normalised copy - or a 400 if it can't be cloned. */
function cloneGraph(template) {
  // A template stored before the tool-node migration clones in the new shape.
  const nodes = normalizeNodes(snapshot(template.nodes)).nodes;
  const edges = snapshot(template.edges);
  // Cloning bypasses the PUT route's guard, so check here too - a template
  // stored before that validation existed could still carry a cycle.
  if (findCycle(nodes, edges)) {
    throw new HttpError(400, `Template "${template.name}" contains a cycle and cannot be used`);
  }
  return { nodes, edges };
}

/** Pre-fills the trigger the template was designed for - always disabled until someone turns it on. */
function triggerFields(template) {
  const trigger = template.trigger || {};
  if (trigger.type === 'event' && trigger.eventName) {
    return { eventTrigger: { eventName: trigger.eventName, enabled: false } };
  }
  if (trigger.type === 'schedule' && isValidCron(trigger.cronExpression)) {
    return { schedule: { cronExpression: trigger.cronExpression, enabled: false } };
  }
  return {};
}

export async function useTemplate(req, res, next) {
  try {
    // A built-in, or one of this workspace's own. Another workspace's template
    // shouldn't even be visible, so it gets the same 404 as a missing one.
    const template = isValidObjectId(req.params.id) ? await findUsable(req, { _id: req.params.id }) : null;
    if (!template) throw new HttpError(404, 'Template not found');

    const { nodes, edges } = cloneGraph(template);

    // Loop/sub-workflow bodies that ship with this template (companions).
    const companionTemplates = [];
    for (const key of template.companions || []) {
      const companion = await findUsable(req, { key });
      if (!companion) throw new HttpError(400, `Template "${template.name}" needs its companion "${key}", which is missing`);
      companionTemplates.push({ key, template: companion, graph: cloneGraph(companion) });
    }

    // Same rule as PUT and the collab op filter (spec/31): a template must not
    // be a way around code:author.
    for (const graph of [{ nodes }, ...companionTemplates.map((c) => c.graph)]) {
      const denied = checkCodeAuthorship([], graph.nodes, req.role);
      if (denied) throw new HttpError(403, `This template includes a Code node. ${denied}`);
    }

    // Companions first, published, so the parent's loop/sub-workflow nodes can
    // point at a real, runnable workflow (children run their published version).
    const created = [];
    const idsByKey = new Map();
    for (const { key, template: companion, graph } of companionTemplates) {
      const workflow = await createInWorkspace(Workflow, req, { name: companion.name, nodes: graph.nodes, edges: graph.edges });
      const published = await publish(req, workflow, { message: `Created from the "${template.name}" template`, acknowledgeWarnings: true });
      if (published.status !== 201) {
        throw new HttpError(400, `Could not publish companion "${companion.name}": ${published.body?.error || published.status}`);
      }
      idsByKey.set(key, String(workflow._id));
      created.push({ _id: workflow._id, name: workflow.name, key });
    }
    for (const node of nodes) {
      const ref = node.data?.config?.workflowId;
      if (typeof ref === 'string' && ref.startsWith(COMPANION_PREFIX)) {
        const id = idsByKey.get(ref.slice(COMPANION_PREFIX.length));
        if (!id) throw new HttpError(400, `Template "${template.name}" references an unknown companion (${ref})`);
        node.data.config.workflowId = id;
      }
    }

    const workflow = await createInWorkspace(Workflow, req, {
      // A built-in is a starting point, so it keeps its name; a clone of one of
      // your own templates is marked as a copy.
      name: String(req.body?.workflowName || '').trim() || (template.workspaceId ? `${template.name} copy` : template.name),
      nodes,
      edges,
      ...triggerFields(template),
    });

    res.status(201).json({
      ...workflow.toObject(),
      companions: created,
      sampleInput: template.sampleInput ?? null,
      fromTemplate: { _id: template._id, key: template.key ?? null, name: template.name },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Loads a template the caller may manage (spec/36 §5): this workspace's own.
 * Built-ins are visible but immutable (403); another workspace's template is
 * invisible, so it gets the same 404 as a missing one.
 */
async function findManageable(req) {
  const template = isValidObjectId(req.params.id)
    ? await Template.findOne(scopedFilter(req, { _id: req.params.id, ...builtInOrOwn(req) }))
    : null;
  if (!template) throw new HttpError(404, 'Template not found');
  if (template.workspaceId === null || template.workspaceId === undefined) {
    throw new HttpError(403, 'Built-in templates cannot be changed');
  }
  return template;
}

export async function updateTemplate(req, res, next) {
  try {
    const template = await findManageable(req);
    const { name, description } = req.body || {};
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) throw new HttpError(400, 'Name is required');
      template.name = trimmed;
    }
    if (description !== undefined) template.description = String(description).trim();
    await template.save();
    res.json(present(template, req.userId));
  } catch (err) {
    next(err);
  }
}

/** Workflows already created from it are copies (spec/15), so they're unaffected. */
export async function deleteTemplate(req, res, next) {
  try {
    const template = await findManageable(req);
    await Template.deleteOne(scopedFilter(req, { _id: template._id }));
    await audit(req, 'template.deleted', { type: 'template', id: template._id, name: template.name });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

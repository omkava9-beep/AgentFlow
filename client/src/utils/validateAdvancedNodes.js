/**
 * spec/31's validation rules for the advanced node types, kept apart from
 * validateGraph so the base rules stay readable. Pushes into the same
 * `{ errors, warnings }` arrays validateGraph builds.
 */

/** Node types with a red `error` source handle (spec/31 §7). */
export const ERROR_HANDLE_TYPES = ['agent', 'tool', 'code', 'subworkflow', 'loop'];

export const MAX_DELAY_MS = 24 * 60 * 60 * 1000;

function sourceParses(source) {
  try {
    // eslint-disable-next-line no-new-func
    new Function('input', source);
    return true;
  } catch {
    return false;
  }
}

/**
 * `workflows`: this workspace's workflows (`[{ _id, name }]`), or null while
 * they load - which skips the "missing workflow" check rather than flagging
 * everything. `currentWorkflowId` catches self-references.
 */
export function validateAdvanced({ nodes, edges, workflows = null, currentWorkflowId = null, errors, warnings, label }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = (id) => edges.filter((e) => e.target === id);

  for (const edge of edges) {
    if (edge.sourceHandle !== 'error') continue;
    const source = byId.get(edge.source);
    if (source && !ERROR_HANDLE_TYPES.includes(source.type)) {
      errors.push({
        id: `error-edge:${edge.id || `${edge.source}-${edge.target}`}`,
        nodeId: source.id,
        message: `"${label(source)}" (${source.type}) can't have an error branch.`,
      });
    }
  }

  for (const node of nodes) {
    const config = node.data?.config || {};
    const name = label(node);
    const warn = (kind, message) => warnings.push({ id: `${kind}:${node.id}`, nodeId: node.id, message });

    if (node.type === 'transform') {
      const keys = (config.mappings || []).map((m) => String(m.key || '').trim());
      if (!keys.length) warn('transform-empty', `"${name}" has no mappings.`);
      else if (keys.some((k) => !k)) warn('transform-key', `"${name}" has a mapping with no key.`);
      else if (new Set(keys).size !== keys.length) warn('transform-dup', `"${name}" maps the same key twice.`);
    }

    // spec/32: an approval routes by its two handles; one left unwired means that
    // outcome silently ends the branch. minApprovals must be a positive count.
    if (node.type === 'approval') {
      const out = edges.filter((e) => e.source === node.id);
      for (const handle of ['approved', 'rejected']) {
        if (!out.some((e) => e.sourceHandle === handle)) {
          warn(`approval-${handle}`, `"${name}" has nothing connected to its ${handle} branch.`);
        }
      }
      const min = Number(config.minApprovals ?? 1);
      const listed = (config.assignees?.userIds || []).length;
      if (!Number.isInteger(min) || min < 1) warn('approval-min', `"${name}" needs at least 1 approval.`);
      else if (listed && !(config.assignees?.roles || []).length && min > listed) {
        warn('approval-min-size', `"${name}" needs ${min} approvals but only ${listed} people are assigned.`);
      }
      if (config.timeout && !(Number(config.timeout.afterMs) > 0)) warn('approval-timeout', `"${name}" has a timeout with no duration.`);
    }

    if (node.type === 'code') {
      const source = String(config.source || '');
      if (!source.trim()) warn('code-empty', `"${name}" has no source.`);
      else if (!sourceParses(source)) warn('code-invalid', `"${name}" has source that doesn't parse.`);
    }

    if (node.type === 'delay') {
      if ((config.mode || 'duration') === 'duration') {
        const ms = Number(config.durationMs);
        if (!ms || ms <= 0) warn('delay-zero', `"${name}" waits for zero time.`);
        else if (ms > MAX_DELAY_MS) warn('delay-long', `"${name}" waits longer than 24 h (the maximum).`);
      } else if (!String(config.until || '').trim()) {
        warn('delay-until', `"${name}" has no "until" date.`);
      }
    }

    if (node.type === 'loop' || node.type === 'subworkflow') {
      const what = node.type === 'loop' ? 'body workflow' : 'workflow';
      if (!config.workflowId) warn(`${node.type}-unset`, `"${name}" has no ${what} selected.`);
      else if (currentWorkflowId && config.workflowId === currentWorkflowId) {
        warn(`${node.type}-self`, `"${name}" calls this workflow itself — recursion is limited to depth 5.`);
      } else if (workflows && !workflows.some((w) => (w._id || w.id) === config.workflowId)) {
        warn(`${node.type}-missing`, `"${name}" points at a ${what} that no longer exists.`);
      } else if (workflows?.find((w) => (w._id || w.id) === config.workflowId)?.publishedVersion === null) {
        // spec/30: children run their published version, so an unpublished
        // child would fail at run time. Mirrored in server/src/engine/validateGraph.js.
        warn(`${node.type}-unpublished`, `"${name}" points at a ${what} that has never been published.`);
      }
    }

    if (node.type === 'loop') {
      const c = Number(config.concurrency ?? 3);
      if (!(c >= 1 && c <= 10)) warn('loop-concurrency', `"${name}" concurrency must be between 1 and 10.`);
      if (!String(config.itemsPath || '').trim()) warn('loop-items', `"${name}" has no items template.`);
    }

    if (node.type === 'merge' && incoming(node.id).length < 2) {
      warn('merge-inputs', `"${name}" has fewer than two incoming branches — nothing to merge.`);
    }
  }
}

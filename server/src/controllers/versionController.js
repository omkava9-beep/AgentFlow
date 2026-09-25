import Workflow from '../models/Workflow.js';
import { findInWorkspace } from '../tenancy/scoped.js';
import * as versions from '../services/versionService.js';

// spec/30's routes. The logic lives in services/versionService.js; these only
// resolve the workflow inside the caller's workspace and shape the response.

export async function publishWorkflow(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    const { message, acknowledgeWarnings } = req.body || {};
    const { status, body } = await versions.publish(req, workflow, { message, acknowledgeWarnings: acknowledgeWarnings === true });
    res.status(status).json(body);
  } catch (err) {
    next(err);
  }
}

export async function listWorkflowVersions(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req, { lean: true });
    res.json(await versions.listVersions(workflow, { page: Number(req.query.page) || 1 }));
  } catch (err) {
    next(err);
  }
}

export async function getWorkflowVersion(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req, { lean: true });
    res.json(await versions.getVersion(workflow, req.params.version));
  } catch (err) {
    next(err);
  }
}

export async function diffWorkflow(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req, { lean: true });
    const parse = (v) => (v === undefined || v === 'draft' || v === 'live' ? v : Number(v));
    res.json(await versions.diff(workflow, { from: parse(req.query.from), to: parse(req.query.to) }));
  } catch (err) {
    next(err);
  }
}

export async function restoreVersion(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    res.json(await versions.restore(req, workflow, req.params.version));
  } catch (err) {
    next(err);
  }
}

export async function rollbackVersion(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    const { status, body } = await versions.rollback(req, workflow, req.params.version, { message: req.body?.message });
    res.status(status).json(body);
  } catch (err) {
    next(err);
  }
}

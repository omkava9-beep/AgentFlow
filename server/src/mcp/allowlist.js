import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';

/**
 * The operator's allowlist of local (stdio) MCP servers (spec/37 §1, C4).
 *
 * A stdio server is a process the backend spawns on its own machine, so a
 * tenant never supplies a command, args or env - they pick an `allowlistId`
 * from this file and nothing else. Read once at startup, like AGENT_PROVIDER.
 */

/** server/ - relative allowlist paths and entry cwd resolve against it. */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The SDK's stdio transport merges these into the child's env by default
// (sudo-style inheritance). spec/37 wants the entry's env plus PATH only, so
// they're explicitly unset - Node skips env keys whose value is undefined.
const SDK_DEFAULT_INHERITED = ['HOME', 'LOGNAME', 'SHELL', 'TERM', 'USER'];

function readFile() {
  const file = path.resolve(SERVER_ROOT, env.mcpAllowlistPath);
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${file} must contain a JSON array`);
  const seen = new Set();
  for (const entry of parsed) {
    if (!entry?.id || !entry.command) throw new Error(`${file}: every entry needs an id and a command`);
    if (seen.has(entry.id)) throw new Error(`${file}: duplicate id "${entry.id}"`);
    seen.add(entry.id);
  }
  return parsed;
}

let entries = readFile();

/** Public shape for the picker - never command, args or env. */
export function listAllowlist() {
  return entries.map(({ id, name, description }) => ({ id, name: name || id, description: description || '' }));
}

export function getAllowlistEntry(id) {
  return entries.find((e) => e.id === id) || null;
}

/**
 * The spawned process's environment: the entry's own env (with `${VAR}`
 * resolved from the SERVER's environment), PATH, and - for entries marked
 * `injectWorkspaceContext` - the workspace the connection belongs to. Never the
 * whole server environment, which holds JWT_SECRET and SECRETS_MASTER_KEY.
 */
export function buildSpawnEnv(entry, { workspaceId } = {}) {
  const out = Object.fromEntries(SDK_DEFAULT_INHERITED.map((k) => [k, undefined]));
  out.PATH = process.env.PATH;
  for (const [key, raw] of Object.entries(entry.env || {})) {
    out[key] = String(raw).replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] ?? '');
  }
  if (entry.injectWorkspaceContext && workspaceId) out.AGENTFLOW_WORKSPACE_ID = String(workspaceId);
  return out;
}

/** Test seam: check scripts swap in their own entries (e.g. an env probe). */
export function __setAllowlistForTests(list) {
  entries = list;
}

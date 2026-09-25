/**
 * `npm run check:all` — every acceptance suite in one command (spec/36 §8), and
 * the CI entry point.
 *
 * Starts the app as a child process on a free port against a throwaway
 * database (INTEGRATIONS_LIVE=false, so nothing leaves the machine), seeds the
 * built-in templates, runs every `check:*` script in package.json one after
 * another with BASE pointed at it, then the client's `check:logic`, prints a
 * summary table, drops the database and exits non-zero if anything failed.
 *
 *   npm run check:all                     # everything
 *   npm run check:all -- --only tenancy,rbac
 *   npm run check:all -- --list
 */
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT_DIR = path.resolve(SERVER_DIR, '..', 'client');
const SUITE_TIMEOUT_MS = 5 * 60 * 1000;
// Never part of check:all: itself, and the live smoke tests that need real
// credentials (spec/27 - they skip without them, but don't belong in CI).
const EXCLUDED = new Set(['check:all', 'check:integrations:live']);

const pkg = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'package.json'), 'utf8'));
const serverSuites = Object.entries(pkg.scripts)
  .filter(([name]) => name.startsWith('check:') && !EXCLUDED.has(name))
  .map(([name, cmd]) => ({ name: name.slice('check:'.length), cmd, cwd: SERVER_DIR }));
const suites = [...serverSuites, { name: 'logic', cmd: 'npm run -s check:logic', cwd: CLIENT_DIR, client: true }];

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const s of suites) console.log(`${s.name.padEnd(14)} ${s.client ? '(client) ' : ''}${s.cmd}`);
  process.exit(0);
}
const onlyArg = args.find((a) => a.startsWith('--only'));
const only = onlyArg ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1] || '').split(',').filter(Boolean) : null;
const selected = only ? suites.filter((s) => only.includes(s.name)) : suites;

if (!process.env.MONGODB_URI) {
  console.error('check:all needs MONGODB_URI (a local MongoDB is enough; the suites use a throwaway database).');
  process.exit(1);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Same server, different database name - never the developer's own data. */
function throwawayUri(base, name) {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

async function dropDatabase(uri) {
  const conn = await mongoose.createConnection(uri).asPromise();
  await conn.dropDatabase();
  await conn.close();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(base, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

/** Last "N passed, M failed" line a suite printed. */
function summarize(output) {
  const matches = [...output.matchAll(/(\d+)\s+passed,\s+(\d+)\s+failed/g)];
  const last = matches.at(-1);
  return last ? { passed: Number(last[1]), failed: Number(last[2]) } : null;
}

function runSuite(suite, env, logFile) {
  return new Promise((resolve) => {
    const [cmd, ...cmdArgs] = suite.cmd.startsWith('npm ')
      ? suite.cmd.split(' ')
      : ['npm', 'run', '-s', `check:${suite.name}`];
    const script = suite.cmd.startsWith('node ') ? suite.cmd.split(' ')[1] : null;
    if (script && !fs.existsSync(path.join(suite.cwd, script))) {
      resolve({ code: 1, output: `missing file: ${script}`, missing: true, ms: 0 });
      return;
    }
    const started = Date.now();
    const child = spawn(cmd, cmdArgs, { cwd: suite.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const out = fs.createWriteStream(logFile);
    const onData = (d) => { output += d; out.write(d); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => {
      output += `\n[check:all] timed out after ${SUITE_TIMEOUT_MS / 1000}s\n`;
      child.kill('SIGKILL');
    }, SUITE_TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      out.end();
      resolve({ code: signal ? 1 : code, output, timedOut: signal === 'SIGKILL', ms: Date.now() - started });
    });
  });
}

async function main() {
  const port = await freePort();
  const dbName = `agentflow-checkall-${port}`;
  const dbUri = throwawayUri(process.env.MONGODB_URI, dbName);
  const base = `http://127.0.0.1:${port}/api`;
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-checkall-'));
  const env = {
    ...process.env,
    MONGODB_URI: dbUri,
    PORT: String(port),
    BASE: base,
    INTEGRATIONS_LIVE: 'false',
    // Checks never spend real model calls, whatever server/.env selects.
    AGENT_PROVIDER: 'mock',
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
  };

  console.log(`check:all · ${selected.length} suite(s) · server :${port} · db ${dbName}`);
  console.log(`logs: ${logDir}\n`);

  await dropDatabase(dbUri).catch(() => {});
  const serverLog = fs.openSync(path.join(logDir, 'server.log'), 'w');
  const server = spawn(process.execPath, ['src/index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', serverLog, serverLog] });
  const stopServer = () => { if (server.exitCode === null) server.kill('SIGTERM'); };
  process.on('SIGINT', () => { stopServer(); process.exit(130); });

  if (!(await waitForHealth(base, server))) {
    console.error('The server did not come up. Last lines of its log:');
    console.error(fs.readFileSync(path.join(logDir, 'server.log'), 'utf8').split('\n').slice(-30).join('\n'));
    stopServer();
    process.exit(1);
  }
  const seeded = spawnSync(process.execPath, ['src/scripts/seedTemplates.js'], { cwd: SERVER_DIR, env, encoding: 'utf8' });
  if (seeded.status !== 0) console.warn('warning: seed:templates failed - check:templates will likely fail');

  const results = [];
  for (const suite of selected) {
    const logFile = path.join(logDir, `${suite.name}.log`);
    const r = await runSuite(suite, env, logFile);
    const counts = summarize(r.output);
    const ok = r.code === 0 && !r.timedOut && !r.missing;
    results.push({ suite, ok, counts, ...r, logFile });
    const detail = r.missing ? r.output : r.timedOut ? 'timed out' : counts ? `${counts.passed} passed, ${counts.failed} failed` : `exit ${r.code}`;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${suite.name.padEnd(14)} ${detail.padEnd(26)} ${(r.ms / 1000).toFixed(1)}s`);
  }

  stopServer();
  await sleep(300);
  await dropDatabase(dbUri).catch(() => {});

  const failed = results.filter((r) => !r.ok);
  const total = results.reduce((n, r) => n + (r.counts?.passed || 0), 0);
  console.log(`\n${results.length - failed.length}/${results.length} suites passed · ${total} checks`);
  for (const f of failed) {
    console.log(`\n--- ${f.suite.name} (last lines of ${f.logFile}) ---`);
    console.log(f.output.split('\n').filter(Boolean).slice(-25).join('\n'));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('check:all crashed:', err);
  process.exit(1);
});

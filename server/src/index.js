import http from 'node:http';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import app from './app.js';
import { registerSocketHandlers } from './sockets/index.js';
import { setIo } from './sockets/ioInstance.js';
import { bootstrapSchedules } from './scheduler/index.js';
import { reconcileInterruptedRuns } from './engine/reconcile.js';
import { bootstrapWaits } from './engine/waitTimers.js';
import { bootstrapRssPollers } from './scheduler/rssPoller.js';
import { migrateWorkspaces } from './scripts/migrateWorkspaces.js';
import { migrateToolNodes } from './scripts/migrateToolNodes.js';
import { hub } from './collab/hub.js';
import { migrateSandboxRecords } from './scripts/migrateSandboxRecords.js';
import { migrateVersions } from './scripts/migrateVersions.js';

export async function main() {
  await connectDB();
  // Before anything reads tenant data: phase-2 documents have no workspaceId
  // until this has run once (spec/22 §8). A no-op on every later boot.
  await migrateWorkspaces();
  // Then the tool-node shape (spec/26 §6), so no legacy node reaches the engine.
  await migrateToolNodes();
  // Then phase 2's MockRecord rows into the spec/27 sandbox store.
  await migrateSandboxRecords();
  // Then v1 for every never-published workflow (spec/30 §8), before the
  // scheduler starts: schedules only run published versions now.
  await migrateVersions();
  // spec/32 §6: nothing can be executing in a process that just started, so
  // runs left pending/running were interrupted. Before the schedulers and the
  // wait timers, so a re-armed timer never meets a half-dead run.
  const { interrupted } = await reconcileInterruptedRuns();
  const { waitingRuns, armed } = await bootstrapWaits();
  console.log(`[reconcile] ${interrupted} interrupted run(s) marked failed, ${waitingRuns} waiting run(s), ${armed} timer(s) re-armed`);

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: env.clientOrigins } });
  setIo(io);
  registerSocketHandlers(io);

  // In-memory cron jobs don't survive a restart, so re-register from MongoDB.
  await bootstrapSchedules();
  // spec/27 §6: the RSS poll ticker, which reconciles subscribers each minute.
  bootstrapRssPollers();

  // Best-effort flush of open collaboration drafts on shutdown (spec/28 §1).
  // SIGUSR2 is nodemon's restart signal: flush, then let it proceed.
  let shuttingDown = false;
  const flushAndExit = (signal) => async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await Promise.race([hub.flushAll(), new Promise((r) => setTimeout(r, 3000))]);
    if (signal === 'SIGUSR2') process.kill(process.pid, 'SIGUSR2');
    else process.exit(0);
  };
  process.once('SIGINT', flushAndExit('SIGINT'));
  process.once('SIGTERM', flushAndExit('SIGTERM'));
  process.once('SIGUSR2', flushAndExit('SIGUSR2'));

  server.listen(env.port, () => {
    console.log(`Server listening on http://localhost:${env.port} (AGENT_PROVIDER=${env.agentProvider})`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

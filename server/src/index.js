import http from 'node:http';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';
import { registerSocketHandlers } from './sockets/index.js';
import { setIo } from './sockets/ioInstance.js';
import { bootstrapSchedules } from './scheduler/index.js';

async function main() {
  await connectDB();

  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: env.clientOrigin } });
  setIo(io);
  registerSocketHandlers(io);

  // In-memory cron jobs don't survive a restart, so re-register from MongoDB.
  await bootstrapSchedules();

  server.listen(env.port, () => {
    console.log(`Server listening on http://localhost:${env.port} (AGENT_PROVIDER=${env.agentProvider})`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

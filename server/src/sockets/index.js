import { queue } from '../queue/index.js';

export function registerSocketHandlers(io) {
  // Broadcast, not run-scoped: the pool is process-wide, so its saturation isn't
  // attributable to any single run.
  queue.on('stats', (stats) => io.emit('queue:stats', stats));

  io.on('connection', (socket) => {
    socket.on('run:subscribe', ({ runId }) => {
      if (runId) socket.join(`run:${runId}`);
    });
    socket.on('run:unsubscribe', ({ runId }) => {
      if (runId) socket.leave(`run:${runId}`);
    });
  });
}

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    socket.on('run:subscribe', ({ runId }) => {
      if (runId) socket.join(`run:${runId}`);
    });
    socket.on('run:unsubscribe', ({ runId }) => {
      if (runId) socket.leave(`run:${runId}`);
    });
  });
}

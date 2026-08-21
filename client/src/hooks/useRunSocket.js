import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getRun } from '../api/runs';

/** Persisted per-node logs, flattened into one chronological-ish tail. */
function seedLogs(run) {
  return (run?.nodeResults || []).flatMap((r) =>
    (r.logs || []).map((line) => ({ nodeId: r.nodeId, line })),
  );
}

export function useRunSocket(runId) {
  const [run, setRun] = useState(null);
  const [logs, setLogs] = useState([]);
  const [queueStats, setQueueStats] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    // Seed from the fetched run, so a *finished* run shows its logs at all - they
    // live in nodeResults[].logs, and the live event stream is long gone by then.
    // A resync replaces rather than appends, which is what keeps reconnects from
    // duplicating every line.
    const sync = () =>
      getRun(runId).then((data) => {
        if (cancelled) return;
        setRun(data);
        setLogs(seedLogs(data));
      });

    sync();

    const socket = io(import.meta.env.VITE_SOCKET_URL);
    socketRef.current = socket;
    socket.emit('run:subscribe', { runId });

    socket.on('connect', sync);

    socket.on('run:started', (payload) => {
      setRun((prev) => (prev ? { ...prev, status: 'running', startedAt: payload.startedAt } : prev));
    });

    socket.on('node:update', (payload) => {
      setRun((prev) => {
        if (!prev) return prev;
        const nodeResults = prev.nodeResults.map((r) => (r.nodeId === payload.nodeId ? { ...r, ...payload } : r));
        return { ...prev, nodeResults };
      });
    });

    // Log lines arrive one at a time on their own event. Appending from
    // `node:update` instead would double-count them, since that event carries the
    // node's full accumulated `logs` array every time it fires.
    socket.on('node:log', (payload) => {
      setLogs((prev) => [...prev, { nodeId: payload.nodeId, line: payload.line }]);
    });

    socket.on('queue:stats', setQueueStats);

    socket.on('run:cancelled', (payload) => {
      setRun((prev) =>
        prev
          ? { ...prev, status: payload.status, cancelReason: payload.cancelReason, finishedAt: payload.finishedAt }
          : prev,
      );
    });

    socket.on('run:completed', (payload) => {
      setRun((prev) => (prev ? { ...prev, status: payload.status, finishedAt: payload.finishedAt } : prev));
    });

    return () => {
      cancelled = true;
      socket.emit('run:unsubscribe', { runId });
      socket.disconnect();
    };
  }, [runId]);

  return { run, logs, queueStats };
}

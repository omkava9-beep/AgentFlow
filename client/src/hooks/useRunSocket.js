import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getRun } from '../api/runs';

export function useRunSocket(runId) {
  const [run, setRun] = useState(null);
  const [logs, setLogs] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    getRun(runId).then((data) => {
      if (!cancelled) setRun(data);
    });

    const socket = io(import.meta.env.VITE_SOCKET_URL);
    socketRef.current = socket;
    socket.emit('run:subscribe', { runId });

    socket.on('connect', () => {
      // resync in case events were missed while disconnected
      getRun(runId).then((data) => {
        if (!cancelled) setRun(data);
      });
    });

    socket.on('run:started', (payload) => {
      setRun((prev) => (prev ? { ...prev, status: 'running', startedAt: payload.startedAt } : prev));
    });

    socket.on('node:update', (payload) => {
      setRun((prev) => {
        if (!prev) return prev;
        const nodeResults = prev.nodeResults.map((r) => (r.nodeId === payload.nodeId ? { ...r, ...payload } : r));
        return { ...prev, nodeResults };
      });
      if (payload.logs?.length) {
        setLogs((prev) => [...prev, ...payload.logs.map((line) => ({ nodeId: payload.nodeId, line }))]);
      }
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

  return { run, logs };
}

import { useEffect, useState } from 'react';
import { getRun } from '../api/runs';
import { on, subscribe } from '../realtime/socket';
import { useWorkspaceStore } from '../store/workspaceStore';

/** Persisted per-node logs, flattened into one chronological-ish tail. */
function seedLogs(run) {
  return (run?.nodeResults || []).flatMap((r) =>
    (r.logs || []).map((line) => ({ nodeId: r.nodeId, line })),
  );
}

/**
 * Live view of one run over the shared session socket (spec/24).
 *
 * `loadError` is 'not-found' when the run isn't in the current workspace
 * (spec/22), 'no-access' when the server refuses the room join - e.g. the
 * membership was revoked after the page loaded - and 'error' otherwise.
 */
export function useRunSocket(runId) {
  const [run, setRun] = useState(null);
  const [logs, setLogs] = useState([]);
  const [queueStats, setQueueStats] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const workspaceId = useWorkspaceStore((s) => s.current?.id);

  useEffect(() => {
    let cancelled = false;

    // Seed from the fetched run, so a *finished* run shows its logs at all - they
    // live in nodeResults[].logs, and the live event stream is long gone by then.
    // A resync replaces rather than appends, which is what keeps reconnects from
    // duplicating every line.
    const sync = () =>
      getRun(runId)
        .then((data) => {
          if (cancelled) return;
          setLoadError(null);
          setRun(data);
          setLogs(seedLogs(data));
        })
        .catch((err) => {
          if (cancelled) return;
          setLoadError(err?.response?.status === 404 ? 'not-found' : 'error');
        });

    // The join is acked on first subscribe and again after every reconnect.
    // Resyncing from the ack (not from 'connect') means we refetch only once
    // we're actually back in the room, so no event can slip between the two.
    let firstAck = true;
    const onAck = (ack) => {
      if (cancelled) return;
      if (ack.ok) {
        if (!firstAck) sync();
        firstAck = false;
      } else if (ack.error === 'not_found') {
        setLoadError('no-access');
      }
    };

    sync();
    const release = subscribe('run', runId, onAck);

    // Events for other runs share this socket, so filter by runId.
    const mine = (handler) => (payload) => {
      if (!cancelled && payload?.runId === runId) handler(payload);
    };

    const offs = [
      on('run:started', mine((payload) => {
        setRun((prev) => (prev ? { ...prev, status: 'running', startedAt: payload.startedAt } : prev));
      })),

      on('node:update', mine((payload) => {
        setRun((prev) => {
          if (!prev) return prev;
          const nodeResults = prev.nodeResults.map((r) => (r.nodeId === payload.nodeId ? { ...r, ...payload } : r));
          return { ...prev, nodeResults };
        });
      })),

      // Log lines arrive one at a time on their own event. Appending from
      // `node:update` instead would double-count them, since that event carries
      // the node's full accumulated `logs` array every time it fires.
      // spec/37 §6: each agent tool call arrives at `started`, then again at
      // `success`/`failed`; rows are keyed by callId so the second replaces the first.
      on('agent:tool_call', mine((payload) => {
        setRun((prev) => {
          if (!prev) return prev;
          const nodeResults = prev.nodeResults.map((r) => {
            if (r.nodeId !== payload.nodeId) return r;
            const calls = r.toolCalls || [];
            const i = calls.findIndex((c) => c.callId === payload.callId);
            const merged = i === -1 ? { ...payload } : { ...calls[i], ...payload };
            return { ...r, toolCalls: i === -1 ? [...calls, merged] : calls.map((c, j) => (j === i ? merged : c)) };
          });
          return { ...prev, nodeResults };
        });
      })),

      // spec/35 §6: one attempt at a time, on its own event, rather than
      // re-sending the growing attemptsLog inside every node:update.
      on('node:attempt', mine((payload) => {
        setRun((prev) => {
          if (!prev) return prev;
          const nodeResults = prev.nodeResults.map((r) =>
            (r.nodeId === payload.nodeId ? { ...r, attemptsLog: [...(r.attemptsLog || []), payload.entry] } : r));
          return { ...prev, nodeResults };
        });
      })),

      on('node:log', mine((payload) => {
        setLogs((prev) => [...prev, { nodeId: payload.nodeId, line: payload.line }]);
      })),

      on('run:cancelled', mine((payload) => {
        setRun((prev) =>
          prev
            ? { ...prev, status: payload.status, cancelReason: payload.cancelReason, finishedAt: payload.finishedAt }
            : prev,
        );
      })),

      // spec/32: the run parked on an approval or a long delay, or a decision
      // woke it. Resync on resume - the decision rewrote the node's approval.
      on('run:waiting', mine(() => {
        setRun((prev) => (prev ? { ...prev, status: 'waiting' } : prev));
      })),
      on('run:resumed', mine(() => {
        setRun((prev) => (prev ? { ...prev, status: 'running' } : prev));
        sync();
      })),

      on('run:completed', mine((payload) => {
        setRun((prev) => (prev ? { ...prev, status: payload.status, finishedAt: payload.finishedAt } : prev));
      })),
    ];

    return () => {
      cancelled = true;
      offs.forEach((off) => off());
      release();
    };
  }, [runId]);

  // Queue stats are per workspace now (the pool is shared, but each tenant only
  // sees its own share of it), delivered to the workspace room WorkspaceRoute
  // keeps the socket in.
  useEffect(() => {
    if (!workspaceId) return undefined;
    return on('queue:stats', (stats) => {
      if (!stats?.workspaceId || stats.workspaceId === workspaceId) setQueueStats(stats);
    });
  }, [workspaceId]);

  return { run, logs, queueStats, loadError };
}

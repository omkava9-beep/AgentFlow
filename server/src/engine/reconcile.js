import Run from '../models/Run.js';

/**
 * spec/32 §6. This process just started, so nothing can be executing: a run
 * still marked pending or running was cut off by a crash or restart. Mark it
 * failed / interrupted instead of leaving it "running" forever (which would
 * also block its workflow's next run via the 409 guard). Parked `waiting` runs
 * are left alone - parking only happens at a clean point, so they resume.
 */
export async function reconcileInterruptedRuns() {
  const runs = await Run.find({ status: { $in: ['pending', 'running'] } }).select('_id nodeResults.status').lean();
  const now = new Date();
  for (const run of runs) {
    await Run.updateOne(
      { _id: run._id, status: { $in: ['pending', 'running'] } },
      {
        $set: {
          status: 'failed',
          failReason: 'interrupted',
          finishedAt: now,
          waiting: [],
          'nodeResults.$[running].status': 'failed',
          'nodeResults.$[running].finishedAt': now,
          'nodeResults.$[open].status': 'skipped',
        },
        $push: { 'nodeResults.$[running].logs': 'server restarted while this node was running' },
      },
      { arrayFilters: [{ 'running.status': 'running' }, { 'open.status': { $in: ['pending', 'waiting'] } }] },
    );
  }
  return { interrupted: runs.length };
}

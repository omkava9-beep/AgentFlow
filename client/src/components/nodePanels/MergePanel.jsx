import { Select } from '../ui';

const MODE_HELP = {
  any: 'Waits for every branch to finish, then runs with whichever succeeded.',
  all: 'Strict join: fails if any branch did not complete.',
  first: 'Runs as soon as the fastest branch succeeds; the others are ignored.',
};

export default function MergePanel({ config, set }) {
  const mode = config.mode || 'any';
  return (
    <>
      <Select label="Mode" value={mode} onChange={(e) => set({ mode: e.target.value })}>
        <option value="any">Any (default)</option>
        <option value="all">All</option>
        <option value="first">First</option>
      </Select>
      <p className="text-xs text-subtle">{MODE_HELP[mode]}</p>
      <Select label="Output" value={config.output || 'keyed'} onChange={(e) => set({ output: e.target.value })}>
        <option value="keyed">Keyed by source node</option>
        <option value="array">Array, in edge order</option>
        <option value="merged">Merged object (later edges win)</option>
      </Select>
    </>
  );
}

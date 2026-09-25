import { useState } from 'react';
import { Select, TextField, NumberField } from '../ui';

const UNITS = { s: 1000, m: 60_000, h: 3_600_000 };

function splitDuration(ms) {
  if (ms && ms % UNITS.h === 0) return { amount: ms / UNITS.h, unit: 'h' };
  if (ms && ms % UNITS.m === 0) return { amount: ms / UNITS.m, unit: 'm' };
  return { amount: (ms || 0) / 1000, unit: 's' };
}

export default function DelayPanel({ config, set }) {
  const mode = config.mode || 'duration';
  const initial = splitDuration(Number(config.durationMs) || 0);
  const [unit, setUnit] = useState(initial.unit);
  const amount = (Number(config.durationMs) || 0) / UNITS[unit];

  return (
    <>
      <Select label="Wait" value={mode} onChange={(e) => set({ mode: e.target.value })}>
        <option value="duration">For a duration</option>
        <option value="until">Until a date</option>
      </Select>
      {mode === 'duration' ? (
        <div className="flex items-end gap-2">
          <NumberField
            label="Duration"
            min="0"
            value={Number.isFinite(amount) ? amount : 0}
            onChange={(e) => set({ durationMs: Math.round(Number(e.target.value) * UNITS[unit]) })}
          />
          <Select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit">
            <option value="s">seconds</option>
            <option value="m">minutes</option>
            <option value="h">hours</option>
          </Select>
        </div>
      ) : (
        <TextField label="Until (ISO date or template)" value={config.until || ''} placeholder="{{input.sendAt}}" onChange={(e) => set({ until: e.target.value })} />
      )}
      <p className="text-xs text-subtle">
        Holds no queue slot while waiting. Up to 60 s runs inline; longer delays park the run (max 24 h).
      </p>
    </>
  );
}

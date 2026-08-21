import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ChartTooltip from './ChartTooltip';
import { formatDayLong, formatDayShort } from '../../utils/format';

/**
 * Single series over time → area chart in one hue. No legend: the panel title
 * names the series. Grid is horizontal-only and hairline so it stays recessive;
 * the value layer is the tooltip crosshair rather than a label on every point.
 */
export default function RunsOverTime({ data, rangeDays }) {
  const gradientId = useId();
  // Thin the ticks so labels can't collide on a 90-day range.
  const tickInterval = rangeDays <= 7 ? 0 : Math.ceil(rangeDays / 8) - 1;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-series)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--viz-series)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="var(--viz-grid)" strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDayShort}
            interval={tickInterval}
            tick={{ fill: 'var(--viz-muted)', fontSize: 11 }}
            stroke="var(--viz-axis)"
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            width={44}
            tick={{ fill: 'var(--viz-muted)', fontSize: 11 }}
            stroke="var(--viz-axis)"
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ stroke: 'var(--viz-series)', strokeWidth: 1, strokeDasharray: '3 3' }}
            content={
              <ChartTooltip
                labelFormatter={formatDayLong}
                valueFormatter={(v) => `${v} ${v === 1 ? 'run' : 'runs'}`}
              />
            }
          />
          <Area
            // Linear, not monotone: these are discrete daily counts, and a spline
            // invents smooth intermediate values between days that never existed.
            type="linear"
            dataKey="count"
            stroke="var(--viz-series)"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--viz-surface)' }}
            dot={false}
            // Recharts reveals a series by animating a clip rect from 0 width.
            // On a dashboard that's noise on every range change, and it leaves the
            // chart blank wherever frames don't advance - screenshots, exports,
            // reduced-motion. The data should just be there.
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

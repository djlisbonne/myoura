import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatClockMinutes, formatDurationMinutes, type MetricDefinition } from '../data/oura'
import type { ChartSeries } from '../lib/api'

export type SleepTimingMode = 'bedtime' | 'duration'

interface SleepTimingPanelProps {
  mode: SleepTimingMode
  onModeChange: (mode: SleepTimingMode) => void
  series: ChartSeries[]
  metricMap: Map<string, MetricDefinition>
}

const modes: Array<{ id: SleepTimingMode; label: string; description: string }> = [
  {
    id: 'bedtime',
    label: 'Bedtime',
    description: 'Actual bedtime and wake timing with the recommended bedtime window from Oura.',
  },
  {
    id: 'duration',
    label: 'Duration',
    description: 'Total sleep, time in bed, and total sleep window over time.',
  },
]

const modeMetricIds: Record<SleepTimingMode, string[]> = {
  bedtime: [
    'sleep.bedtime_start_minutes',
    'sleep.bedtime_end_minutes',
    'sleep_time.optimal_bedtime.start_offset_minutes',
    'sleep_time.optimal_bedtime.end_offset_minutes',
  ],
  duration: [
    'sleep.total_sleep_duration_minutes',
    'sleep.time_in_bed_minutes',
    'sleep.bedtime_duration_minutes',
  ],
}

function buildPoints(series: ChartSeries[]) {
  const xValues = [...new Set(series.flatMap((entry) => entry.points.map((point) => point.x)))].sort()
  return xValues.map((x, index) => {
    const point: Record<string, number | string | null> = {
      x,
      dateLabel: new Date(x.includes('T') ? x : `${x}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      indexLabel: `${index + 1}`,
    }

    for (const entry of series) {
      const sourcePoint = entry.points.find((item) => item.x === x)
      point[entry.metricId] = sourcePoint?.value ?? null
    }

    return point
  })
}

function tooltipValue(metricId: string, value: number) {
  if (metricId.includes('bedtime')) {
    return formatClockMinutes(value)
  }
  return formatDurationMinutes(value)
}

export function SleepTimingPanel({ mode, onModeChange, series, metricMap }: SleepTimingPanelProps) {
  const activeSeries = series.filter((entry) => modeMetricIds[mode].includes(entry.metricId))
  if (activeSeries.length === 0) {
    return null
  }

  const chartData = buildPoints(activeSeries)

  return (
    <section className="sleep-timing-panel">
      <div className="sleep-timing-panel__header">
        <div>
          <p className="sleep-timing-panel__eyebrow">Sleep timing</p>
          <h3>Raw nightly sleep timing over time</h3>
          <p>{modes.find((entry) => entry.id === mode)?.description}</p>
        </div>
      </div>

      <div className="sleep-timing-panel__modes" role="tablist" aria-label="Sleep timing modes">
        {modes.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`segment ${mode === entry.id ? 'segment--active' : ''}`}
            onClick={() => onModeChange(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="sleep-timing-panel__chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 12, right: 12, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" strokeDasharray="4 8" />
            <XAxis
              dataKey="dateLabel"
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'rgba(226, 232, 240, 0.68)', fontSize: 12 }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={72}
              tickFormatter={(value) => (mode === 'bedtime' ? formatClockMinutes(value) : formatDurationMinutes(value))}
              tick={{ fill: 'rgba(226, 232, 240, 0.68)', fontSize: 12 }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) {
                  return null
                }

                return (
                  <div className="chart-tooltip">
                    <p className="chart-tooltip__date">{String(payload[0]?.payload?.dateLabel ?? '')}</p>
                    <div className="chart-tooltip__rows">
                      {activeSeries.map((entry) => {
                        const value = payload[0]?.payload?.[entry.metricId]
                        const metric = metricMap.get(entry.metricId)
                        if (typeof value !== 'number' || !metric) {
                          return null
                        }

                        return (
                          <div className="chart-tooltip__row" key={entry.metricId}>
                            <span className="chart-tooltip__dot" style={{ backgroundColor: metric.color }} />
                            <span>{metric.label}</span>
                            <strong>{tooltipValue(entry.metricId, value)}</strong>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              }}
            />
            {activeSeries.map((entry) => {
              const metric = metricMap.get(entry.metricId)
              if (!metric) {
                return null
              }

              return (
                <Line
                  key={entry.metricId}
                  type="monotone"
                  dataKey={entry.metricId}
                  stroke={metric.color}
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{ r: 4.5, strokeWidth: 0 }}
                  connectNulls
                />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

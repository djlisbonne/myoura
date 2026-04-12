import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatClockMinutes, formatDurationMinutes, formatMetricValue, type MetricDefinition } from '../data/oura'
import type { ChartSeries } from '../lib/api'
import { type AxisSide, buildOverlayChartData, displayDataKey, type DisplayMode, type OverlayPoint, type XAxisMode } from '../lib/chart'

interface OverlayChartProps {
  series: ChartSeries[]
  metricMap: Map<string, MetricDefinition>
  axisByMetric: Record<string, AxisSide | 'off'>
  displayMode: DisplayMode
  xAxisMode: XAxisMode
}

function tickFormatter(value: number, mode: DisplayMode, metricIds: string[], metricMap: Map<string, MetricDefinition>) {
  if (mode === 'normalized') {
    return `${Math.round(value * 100)}%`
  }

  if (mode === 'relative') {
    return `${value.toFixed(0)}%`
  }

  const metrics = metricIds.map((metricId) => metricMap.get(metricId)).filter((entry): entry is MetricDefinition => Boolean(entry))
  if (metrics.length === 1) {
    const metric = metrics[0]
    if (metric.metricId.includes('bedtime') && metric.unit === 'min') {
      return formatClockMinutes(value)
    }
    if (metric.metricId.includes('duration') && metric.unit === 'min') {
      return formatDurationMinutes(value)
    }
    if (metric.metricId.includes('duration') && metric.unit === 'sec') {
      return formatDurationMinutes(value / 60)
    }
  }

  if (Math.abs(value) >= 1000) {
    return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  }

  return Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
}

function axisLabel(metricIds: string[], mode: DisplayMode, metricMap: Map<string, MetricDefinition>) {
  if (metricIds.length === 0) {
    return 'unused'
  }

  if (mode === 'normalized') {
    return 'percentile position'
  }

  if (mode === 'relative') {
    return '% from baseline'
  }

  const units = [...new Set(metricIds.map((metricId) => metricMap.get(metricId)?.unit ?? ''))].filter(Boolean)
  return units.length === 1 ? units[0] : 'mixed units'
}

function CustomTooltip({
  active,
  payload,
  series,
  metricMap,
  displayMode,
}: {
  active?: boolean
  payload?: Array<{ payload?: OverlayPoint }>
  series: ChartSeries[]
  metricMap: Map<string, MetricDefinition>
  displayMode: DisplayMode
}) {
  if (!active || !payload?.length) {
    return null
  }

  const point = payload[0]?.payload
  if (!point) {
    return null
  }

  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip__date">{point.dateLabel}</p>
      <div className="chart-tooltip__rows">
        {series.map((entry) => {
          const metric = metricMap.get(entry.metricId)
          if (!metric) {
            return null
          }

          const rawValue = point.raw[entry.metricId] ?? null
          const displayValue =
            displayMode === 'raw'
              ? formatMetricValue(metric, rawValue)
              : displayMode === 'normalized'
                ? typeof point.normalized[entry.metricId] === 'number'
                  ? `${Math.round((point.normalized[entry.metricId] as number) * 100)}%`
                  : '—'
                : typeof point.relative[entry.metricId] === 'number'
                  ? `${(point.relative[entry.metricId] as number) >= 0 ? '+' : ''}${(point.relative[entry.metricId] as number).toFixed(1)}%`
                  : '—'

          return (
            <div className="chart-tooltip__row" key={entry.metricId}>
              <span className="chart-tooltip__dot" style={{ backgroundColor: metric.color }} />
              <span>{metric.label}</span>
              <strong>{displayValue}</strong>
              {displayMode !== 'raw' ? <span className="chart-tooltip__secondary">{formatMetricValue(metric, rawValue)}</span> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function OverlayChart({ series, metricMap, axisByMetric, displayMode, xAxisMode }: OverlayChartProps) {
  if (series.length === 0) {
    return (
      <div className="chart-empty">
        <strong>No chartable metrics selected.</strong>
        <p>Choose one or more metrics from the browser to compose a view.</p>
      </div>
    )
  }

  const chartData = buildOverlayChartData(series)
  const leftMetricIds = series.filter((entry) => axisByMetric[entry.metricId] === 'left').map((entry) => entry.metricId)
  const rightMetricIds = series.filter((entry) => axisByMetric[entry.metricId] === 'right').map((entry) => entry.metricId)

  return (
    <div className="chart-shell">
      <div className="chart-shell__meta">
        <div>
          <p className="chart-shell__label">Composed view</p>
          <p className="chart-shell__copy">
            Every series in this chart comes directly from the local Oura API store and can be overlaid regardless of unit.
          </p>
        </div>
        <div className="chart-shell__legend">
          {series.map((entry) => {
            const metric = metricMap.get(entry.metricId)
            if (!metric) {
              return null
            }
            return (
              <span key={entry.metricId} className="legend-chip">
                <span className="legend-chip__dot" style={{ backgroundColor: metric.color }} />
                {metric.label}
              </span>
            )
          })}
        </div>
      </div>

      <div className="chart-shell__canvas">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 16, right: 12, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" strokeDasharray="4 8" />
            <XAxis
              dataKey={xAxisMode === 'date' ? 'dateLabel' : 'sequenceLabel'}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'rgba(226, 232, 240, 0.68)', fontSize: 12 }}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              width={72}
              tickFormatter={(value) => tickFormatter(value, displayMode, leftMetricIds, metricMap)}
              tick={{ fill: 'rgba(226, 232, 240, 0.68)', fontSize: 12 }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={72}
              tickFormatter={(value) => tickFormatter(value, displayMode, rightMetricIds, metricMap)}
              tick={{ fill: 'rgba(226, 232, 240, 0.68)', fontSize: 12 }}
            />
            <Tooltip
              content={(tooltipProps: unknown) => (
                <CustomTooltip
                  {...(tooltipProps as { active?: boolean; payload?: Array<{ payload?: OverlayPoint }> })}
                  series={series}
                  metricMap={metricMap}
                  displayMode={displayMode}
                />
              )}
            />
            {series.map((entry) => {
              const metric = metricMap.get(entry.metricId)
              if (!metric) {
                return null
              }
              return (
                <Line
                  key={entry.metricId}
                  yAxisId={axisByMetric[entry.metricId]}
                  type="monotone"
                  dataKey={displayDataKey(entry.metricId, displayMode)}
                  stroke={metric.color}
                  strokeWidth={2.4}
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 0 }}
                  connectNulls
                />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-shell__footer">
        <span>Left axis: {axisLabel(leftMetricIds, displayMode, metricMap)}</span>
        <span>Right axis: {axisLabel(rightMetricIds, displayMode, metricMap)}</span>
      </div>
    </div>
  )
}

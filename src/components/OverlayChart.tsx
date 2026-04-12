import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MetricId } from '../data/oura'
import { formatMetricValue, getMetricDefinition } from '../data/oura'
import { type AxisSide, displayDataKey, type DisplayMode, type OverlayPoint, type XAxisMode } from '../lib/chart'

interface OverlayChartProps {
  chartData: OverlayPoint[]
  visibleMetricIds: MetricId[]
  axisByMetric: Record<MetricId, AxisSide | 'off'>
  displayMode: DisplayMode
  xAxisMode: XAxisMode
}

interface TooltipProps {
  active?: boolean
  visibleMetricIds: MetricId[]
  displayMode: DisplayMode
  payload?: Array<{
    payload?: OverlayPoint
  }>
}

function formatDisplayValue(metricId: MetricId, mode: DisplayMode, point: OverlayPoint) {
  if (mode === 'normalized') {
    return `${point.normalized[metricId].toFixed(2)} sd`
  }

  if (mode === 'relative') {
    const value = point.relative[metricId]
    const prefix = value > 0 ? '+' : ''
    return `${prefix}${value.toFixed(1)}%`
  }

  return formatMetricValue(metricId, point.raw[metricId])
}

function tickFormatter(value: number, mode: DisplayMode) {
  if (mode === 'normalized') {
    return value.toFixed(1)
  }

  if (mode === 'relative') {
    return `${value.toFixed(0)}%`
  }

  if (Math.abs(value) >= 1000) {
    return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  }

  return Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
}

function axisLabel(metricIds: MetricId[], mode: DisplayMode) {
  if (metricIds.length === 0) {
    return 'unused'
  }

  if (mode === 'normalized') {
    return 'std dev'
  }

  if (mode === 'relative') {
    return '% change'
  }

  const units = [...new Set(metricIds.map((metricId) => getMetricDefinition(metricId).unit))]
  return units.length === 1 ? units[0] : 'mixed units'
}

function CustomTooltip({ active, payload, visibleMetricIds, displayMode }: TooltipProps) {
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
        {visibleMetricIds.map((metricId) => {
          const metric = getMetricDefinition(metricId)

          return (
            <div className="chart-tooltip__row" key={metricId}>
              <span className="chart-tooltip__dot" style={{ backgroundColor: metric.color }} />
              <span>{metric.label}</span>
              <strong>{formatDisplayValue(metricId, displayMode, point)}</strong>
              {displayMode !== 'raw' ? (
                <span className="chart-tooltip__secondary">{formatMetricValue(metricId, point.raw[metricId])}</span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function OverlayChart({
  chartData,
  visibleMetricIds,
  axisByMetric,
  displayMode,
  xAxisMode,
}: OverlayChartProps) {
  const leftMetricIds = visibleMetricIds.filter((metricId) => axisByMetric[metricId] === 'left')
  const rightMetricIds = visibleMetricIds.filter((metricId) => axisByMetric[metricId] === 'right')

  if (visibleMetricIds.length === 0) {
    return (
      <div className="chart-empty">
        <strong>No metrics selected.</strong>
        <p>Add metrics from the browser to start composing a view.</p>
      </div>
    )
  }

  return (
    <div className="chart-shell">
      <div className="chart-shell__meta">
        <div>
          <p className="chart-shell__label">Composed view</p>
          <p className="chart-shell__copy">
            Switch between raw units, standardized overlays, and baseline-relative movement without leaving the chart.
          </p>
        </div>
        <div className="chart-shell__legend">
          {visibleMetricIds.map((metricId) => {
            const metric = getMetricDefinition(metricId)
            return (
              <span key={metricId} className="legend-chip">
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
              width={52}
              tickFormatter={(value) => tickFormatter(value, displayMode)}
              tick={{ fill: 'rgba(226, 232, 240, 0.68)', fontSize: 12 }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(value) => tickFormatter(value, displayMode)}
              tick={{ fill: 'rgba(226, 232, 240, 0.68)', fontSize: 12 }}
            />
            <Tooltip
              content={(tooltipProps: unknown) => (
                <CustomTooltip
                  {...(tooltipProps as Omit<TooltipProps, 'visibleMetricIds' | 'displayMode'>)}
                  visibleMetricIds={visibleMetricIds}
                  displayMode={displayMode}
                />
              )}
            />
            {visibleMetricIds.map((metricId) => {
              const metric = getMetricDefinition(metricId)
              return (
                <Line
                  key={metricId}
                  yAxisId={axisByMetric[metricId]}
                  type="monotone"
                  dataKey={displayDataKey(metricId, displayMode)}
                  stroke={metric.color}
                  strokeWidth={2.4}
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 0 }}
                />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-shell__footer">
        <span>Left axis: {axisLabel(leftMetricIds, displayMode)}</span>
        <span>Right axis: {axisLabel(rightMetricIds, displayMode)}</span>
      </div>
    </div>
  )
}

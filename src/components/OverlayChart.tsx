import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MetricId, OuraDay } from '../data/oura'
import { getMetricDefinition } from '../data/oura'
import type { OverlayPoint } from '../lib/chart'

interface OverlayChartProps {
  records: OuraDay[]
  selectedMetricIds: MetricId[]
  chartData: OverlayPoint[]
}

interface TooltipProps {
  active?: boolean
  selectedMetricIds: MetricId[]
  payload?: Array<{
    payload?: {
      dateLabel: string
      raw: Record<MetricId, number>
      normalized: Record<MetricId, number>
    }
  }>
}

function CustomTooltip({ active, payload, selectedMetricIds }: TooltipProps) {
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
        {selectedMetricIds.map((metricId) => {
          const metric = getMetricDefinition(metricId)
          const rawValue = point.raw[metricId]
          const normalizedValue = point.normalized[metricId]

          return (
            <div className="chart-tooltip__row" key={metricId}>
              <span className="chart-tooltip__dot" style={{ backgroundColor: metric.color }} />
              <span>{metric.label}</span>
              <strong>{rawValue.toLocaleString(undefined, { maximumFractionDigits: metric.precision ?? 0 })}</strong>
              <span className="chart-tooltip__secondary">
                norm {normalizedValue.toFixed(2)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function OverlayChart({
  records,
  selectedMetricIds,
  chartData,
}: OverlayChartProps) {
  return (
    <div className="chart-shell">
      <div className="chart-shell__meta">
        <div>
          <p className="chart-shell__label">Normalized overlay</p>
          <p className="chart-shell__copy">
            Each series is z-scored across the active window so different units can be compared on one axis.
          </p>
        </div>
        <div className="chart-shell__legend">
          {selectedMetricIds.map((metricId) => {
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
          <LineChart data={chartData} margin={{ top: 12, right: 16, bottom: 8, left: -4 }}>
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
              width={32}
              domain={[-2.5, 2.5]}
              tick={{ fill: 'rgba(226, 232, 240, 0.68)', fontSize: 12 }}
            />
            <Tooltip content={(tooltipProps: unknown) => (
              <CustomTooltip
                {...(tooltipProps as Omit<TooltipProps, 'selectedMetricIds'>)}
                selectedMetricIds={selectedMetricIds}
              />
            )} />
            {selectedMetricIds.map((metricId) => {
              const metric = getMetricDefinition(metricId)
              return (
                <Line
                  key={metricId}
                  type="monotone"
                  dataKey={metricId}
                  stroke={metric.color}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 0 }}
                />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-shell__footer">
        <span>{records.length} days in view</span>
        <span>Overlay is interactive and color-coded by metric source</span>
      </div>
    </div>
  )
}

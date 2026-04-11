import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { MetricDelta } from '../lib/analytics'
import { formatMetricValue, getMetricDefinition } from '../data/oura'
import { formatDelta, trendFromDelta } from '../lib/analytics'

interface SummaryCardsProps {
  deltas: MetricDelta[]
}

export function SummaryCards({ deltas }: SummaryCardsProps) {
  return (
    <div className="summary-grid">
      {deltas.map((delta) => {
        const metric = getMetricDefinition(delta.metricId)
        const direction = trendFromDelta(delta.delta)
        const statusClass = direction === 'rising' ? 'positive' : direction === 'falling' ? 'negative' : 'neutral'
        const Icon = direction === 'rising' ? ArrowUpRight : direction === 'falling' ? ArrowDownRight : Minus

        return (
          <article className="summary-card" key={delta.metricId}>
            <div className="summary-card__top">
              <div>
                <p className="summary-card__label">{metric.label}</p>
                <p className="summary-card__value">{formatMetricValue(delta.metricId, delta.current)}</p>
              </div>
              <span className={`badge badge--${statusClass}`}>
                <Icon size={14} />
                {formatDelta(delta.delta, metric.precision ?? 0)}
              </span>
            </div>
            <p className="summary-card__meta">
              {metric.description}
              <span>Trend: {direction}</span>
            </p>
          </article>
        )
      })}
    </div>
  )
}


import { Check, Plus } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { MetricDefinition, MetricId } from '../data/oura'

interface MetricComposerProps {
  metrics: readonly MetricDefinition[]
  selectedMetricIds: MetricId[]
  onToggleMetric: (metricId: MetricId) => void
  onReset: () => void
  busy?: boolean
}

export function MetricComposer({
  metrics,
  selectedMetricIds,
  onToggleMetric,
  onReset,
  busy,
}: MetricComposerProps) {
  const groupedMetrics = metrics.reduce<Record<string, MetricDefinition[]>>((groups, metric) => {
    const bucket = groups[metric.category] ?? []
    bucket.push(metric)
    groups[metric.category] = bucket
    return groups
  }, {})

  return (
    <div className="composer">
      <div className="composer__selected">
        <div className="composer__stack">
          {selectedMetricIds.map((metricId, index) => {
            const metric = metrics.find((item) => item.id === metricId)!

            return (
              <button
                key={metric.id}
                type="button"
                className="metric-pill metric-pill--active"
                onClick={() => onToggleMetric(metricId)}
                    style={{ '--metric-color': metric.color } as CSSProperties}
                    aria-label={`Remove ${metric.label}`}
                  >
                <span className="metric-pill__index">{index + 1}</span>
                <span>{metric.label}</span>
                <Check size={14} />
              </button>
            )
          })}
        </div>

        <button type="button" className="ghost-button" onClick={onReset} disabled={busy}>
          Reset view
        </button>
      </div>

      <div className="composer__groups">
        {Object.entries(groupedMetrics).map(([category, group]) => (
          <div className="composer__group" key={category}>
            <div className="composer__group-header">
              <p>{category}</p>
              <span>{group.length} metrics</span>
            </div>
            <div className="composer__metrics">
              {group.map((metric) => {
                const metricId = metric.id as MetricId
                const selected = selectedMetricIds.includes(metricId)

                return (
                  <button
                    key={metric.id}
                    type="button"
                    className={`metric-pill ${selected ? 'metric-pill--active' : ''}`}
                    onClick={() => onToggleMetric(metricId)}
                    style={{ '--metric-color': metric.color } as CSSProperties}
                    aria-pressed={selected}
                  >
                    <span
                      className="metric-pill__dot"
                      style={{ backgroundColor: metric.color }}
                    />
                    <span>{metric.label}</span>
                    {selected ? <Check size={14} /> : <Plus size={14} />}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

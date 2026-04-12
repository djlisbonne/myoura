import { Search } from 'lucide-react'
import type { MetricDefinition, MetricPreset } from '../data/oura'
import type { AxisSide } from '../lib/chart'

interface MetricBrowserProps {
  metrics: readonly MetricDefinition[]
  selectedMetricIds: string[]
  axisByMetric: Record<string, AxisSide | 'off'>
  presets: MetricPreset[]
  activePresetId: string
  query: string
  onQueryChange: (value: string) => void
  onAxisChange: (metricId: string, axis: AxisSide | 'off') => void
  onPresetChange: (presetId: string) => void
  busy?: boolean
}

export function MetricBrowser({
  metrics,
  selectedMetricIds,
  axisByMetric,
  presets,
  activePresetId,
  query,
  onQueryChange,
  onAxisChange,
  onPresetChange,
  busy,
}: MetricBrowserProps) {
  const grouped = metrics.reduce<Record<string, MetricDefinition[]>>((accumulator, metric) => {
    const bucket = accumulator[metric.resourceLabel] ?? []
    bucket.push(metric)
    accumulator[metric.resourceLabel] = bucket
    return accumulator
  }, {})

  const resourceLabels = Object.keys(grouped).sort((left, right) => left.localeCompare(right))

  return (
    <section className="metric-browser">
      <div className="control-block__header">
        <span className="control-label">Metric browser</span>
        <span className="control-hint">{selectedMetricIds.length} in chart</span>
      </div>

      {presets.length > 0 ? (
        <div className="preset-strip" role="tablist" aria-label="Metric presets">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`preset-chip ${activePresetId === preset.id ? 'preset-chip--active' : ''}`}
              onClick={() => onPresetChange(preset.id)}
              disabled={busy}
            >
              <strong>{preset.label}</strong>
              <span>{preset.description}</span>
            </button>
          ))}
        </div>
      ) : null}

      <label className="search-input">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search metrics, resources, units"
        />
      </label>

      <div className="metric-browser__selected">
        <div className="metric-browser__selected-header">
          <span>Active series</span>
          <span>{selectedMetricIds.length} selected</span>
        </div>
        <div className="metric-browser__selected-list">
          {selectedMetricIds.length > 0 ? (
            selectedMetricIds.map((metricId) => {
              const metric = metrics.find((entry) => entry.metricId === metricId)
              if (!metric) {
                return null
              }

              return (
                <span key={metric.metricId} className="metric-pill metric-pill--active">
                  <span className="legend-chip__dot" style={{ backgroundColor: metric.color }} />
                  {metric.label}
                  <span className="metric-pill__axis">{axisByMetric[metricId] === 'left' ? 'L' : 'R'}</span>
                </span>
              )
            })
          ) : (
            <span className="metric-browser__empty">Pick metrics from the resource list to build the chart.</span>
          )}
        </div>
      </div>

      <div className="metric-browser__groups">
        {resourceLabels.map((resourceLabel) => (
          <details key={resourceLabel} className="metric-group" open={query.trim().length > 0}>
            <summary className="metric-group__summary">
              <div>
                <strong>{resourceLabel}</strong>
                <span>{grouped[resourceLabel].length} metrics</span>
              </div>
              <span className="metric-group__summary-note">Browse</span>
            </summary>
            <div className="metric-group__metrics">
              {grouped[resourceLabel].map((metric) => (
                <article className="metric-row" key={metric.metricId}>
                  <div className="metric-row__meta">
                    <span className="metric-dot" style={{ backgroundColor: metric.color }} />
                    <div>
                      <div className="metric-row__topline">
                        <strong>{metric.label}</strong>
                        <span>{metric.unit ?? metric.category}</span>
                      </div>
                      <p>{metric.description}</p>
                      <small>{metric.metricId}</small>
                    </div>
                  </div>
                  <div className="metric-axis-picker">
                    {(['off', 'left', 'right'] as const).map((side) => (
                      <button
                        key={side}
                        type="button"
                        className={`axis-chip ${axisByMetric[metric.metricId] === side ? 'axis-chip--active' : ''}`}
                        onClick={() => onAxisChange(metric.metricId, side)}
                        disabled={busy}
                      >
                        {side === 'off' ? 'Off' : side === 'left' ? 'Left' : 'Right'}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

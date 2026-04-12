import type { SourceGroupView, SourceMetricView } from '../lib/api'

export type MetricId = string
export type AxisSide = 'left' | 'right'

export interface MetricDefinition extends SourceMetricView {
  resourceLabel: string
  resourceKind: SourceGroupView['kind']
  color: string
}

export interface MetricPreset {
  id: string
  label: string
  description: string
  metricIds: string[]
}

const palette = [
  '#7dd3fc',
  '#86efac',
  '#c084fc',
  '#f59e0b',
  '#fb7185',
  '#22d3ee',
  '#a78bfa',
  '#f97316',
  '#60a5fa',
  '#14b8a6',
  '#f472b6',
  '#38bdf8',
  '#34d399',
  '#fca5a5',
  '#fcd34d',
  '#818cf8',
  '#2dd4bf',
  '#fb923c',
]

function hashMetric(metricId: string) {
  let hash = 0
  for (let index = 0; index < metricId.length; index += 1) {
    hash = (hash * 31 + metricId.charCodeAt(index)) >>> 0
  }
  return hash
}

export function metricColor(metricId: string) {
  return palette[hashMetric(metricId) % palette.length]
}

export function buildMetricCatalog(groups: SourceGroupView[]): MetricDefinition[] {
  return groups
    .flatMap((group) =>
      group.metrics.map((metric) => ({
        ...metric,
        resourceLabel: group.label,
        resourceKind: group.kind,
        color: metricColor(metric.metricId),
      })),
    )
    .sort((left, right) => {
      if (left.chartable !== right.chartable) {
        return left.chartable ? -1 : 1
      }
      return left.label.localeCompare(right.label)
    })
}

function hasMetric(metricIds: string[], metricId: string) {
  return metricIds.includes(metricId)
}

export function metricPresets(metricIds: string[]): MetricPreset[] {
  const presets: MetricPreset[] = []

  if (
    hasMetric(metricIds, 'daily_readiness.score') &&
    hasMetric(metricIds, 'daily_sleep.score') &&
    hasMetric(metricIds, 'sleep.average_hrv') &&
    hasMetric(metricIds, 'sleep.lowest_heart_rate')
  ) {
    presets.push({
      id: 'recovery',
      label: 'Recovery',
      description: 'Readiness, sleep, HRV, and lowest nightly heart rate.',
      metricIds: ['daily_readiness.score', 'daily_sleep.score', 'sleep.average_hrv', 'sleep.lowest_heart_rate'],
    })
  }

  if (
    hasMetric(metricIds, 'sleep.bedtime_start_minutes') &&
    hasMetric(metricIds, 'sleep.bedtime_end_minutes') &&
    hasMetric(metricIds, 'sleep.total_sleep_duration_minutes') &&
    hasMetric(metricIds, 'sleep_time.optimal_bedtime.start_offset_minutes')
  ) {
    presets.push({
      id: 'sleep-timing',
      label: 'Sleep timing',
      description: 'Bedtime, wake timing, sleep duration, and recommended bedtime.',
      metricIds: [
        'sleep.bedtime_start_minutes',
        'sleep.bedtime_end_minutes',
        'sleep.total_sleep_duration_minutes',
        'sleep_time.optimal_bedtime.start_offset_minutes',
      ],
    })
  }

  if (
    hasMetric(metricIds, 'daily_activity.steps') &&
    hasMetric(metricIds, 'daily_activity.score') &&
    hasMetric(metricIds, 'daily_activity.active_calories')
  ) {
    presets.push({
      id: 'activity',
      label: 'Activity',
      description: 'Steps, activity score, and active calories.',
      metricIds: ['daily_activity.steps', 'daily_activity.score', 'daily_activity.active_calories'],
    })
  }

  if (
    hasMetric(metricIds, 'daily_stress.stress_high') &&
    hasMetric(metricIds, 'daily_stress.recovery_high') &&
    hasMetric(metricIds, 'daily_resilience.level')
  ) {
    presets.push({
      id: 'stress',
      label: 'Stress',
      description: 'Stress load, recovery time, and resilience level.',
      metricIds: ['daily_stress.stress_high', 'daily_stress.recovery_high', 'daily_resilience.level'],
    })
  }

  return presets
}

export function defaultSelectedMetricIds(availableMetricIds: string[]) {
  const defaults = [
    'daily_readiness.score',
    'daily_sleep.score',
    'daily_activity.steps',
    'sleep.bedtime_start_minutes',
    'sleep.total_sleep_duration_minutes',
    'sleep_time.optimal_bedtime.start_offset_minutes',
  ]

  const selected = defaults.filter((metricId) => availableMetricIds.includes(metricId))
  return selected.length > 0 ? selected : availableMetricIds.slice(0, 6)
}

export const rangeOptions = [14, 30, 60, 90]

function formatCompactNumber(value: number, maximumFractionDigits = 1) {
  return Intl.NumberFormat('en-US', {
    notation: Math.abs(value) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits,
  }).format(value)
}

export function formatClockMinutes(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440
  const hours = Math.floor(normalized / 60)
  const minutes = Math.round(normalized % 60)
  return new Date(Date.UTC(2026, 0, 1, hours, minutes)).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatDurationMinutes(value: number) {
  const hours = Math.floor(value / 60)
  const minutes = Math.round(value % 60)
  if (hours <= 0) {
    return `${minutes}m`
  }
  return `${hours}h ${minutes}m`
}

export function formatMetricValue(metric: Pick<MetricDefinition, 'metricId' | 'unit' | 'category'>, value: number | null, textValue?: string | null) {
  if (value === null || !Number.isFinite(value)) {
    return textValue ?? '—'
  }

  if (metric.metricId.includes('bedtime') && metric.unit === 'min') {
    return formatClockMinutes(value)
  }

  if (metric.metricId.includes('duration') && metric.unit === 'min') {
    return formatDurationMinutes(value)
  }

  if (metric.metricId.includes('duration') && metric.unit === 'sec') {
    return formatDurationMinutes(value / 60)
  }

  if (metric.unit === 'score') {
    return `${Math.round(value)}`
  }

  if (metric.unit === '%' || metric.unit === 'percent') {
    return `${value.toFixed(1)}%`
  }

  if (metric.unit === 'bpm' || metric.unit === 'ms' || metric.unit === 'count' || metric.unit === 'steps') {
    return `${formatCompactNumber(value, 0)} ${metric.unit}`.trim()
  }

  if (metric.unit === 'kcal' || metric.unit === 'm' || metric.unit === 'ml/kg/min' || metric.unit === 'years') {
    return `${formatCompactNumber(value)} ${metric.unit}`.trim()
  }

  if (metric.unit === 'min') {
    return `${formatCompactNumber(value)} min`
  }

  if (metric.unit === 'sec') {
    return `${formatCompactNumber(value)} sec`
  }

  if (metric.unit) {
    return `${formatCompactNumber(value)} ${metric.unit}`.trim()
  }

  return formatCompactNumber(value)
}

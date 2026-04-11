import type { MetricId, OuraDay } from '../data/oura'
import { formatMetricValue, getMetricDefinition } from '../data/oura'

export interface MetricDelta {
  metricId: MetricId
  current: number
  previous: number
  delta: number
  deltaPercent: number | null
}

export interface RelationshipInsight {
  left: MetricId
  right: MetricId
  correlation: number
  label: string
  interpretation: string
}

export interface ChatContextSnapshot {
  windowLabel: string
  selectedMetrics: Array<{
    metricId: MetricId
    label: string
    value: string
  }>
  keyRelationships: RelationshipInsight[]
  headline: string
  notes: string[]
}

export const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function standardDeviation(values: number[]) {
  if (values.length < 2) {
    return 0
  }

  const avg = mean(values)
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1)

  return Math.sqrt(variance)
}

export function pearsonCorrelation(left: number[], right: number[]) {
  const pairCount = Math.min(left.length, right.length)

  if (pairCount < 2) {
    return 0
  }

  const leftSlice = left.slice(0, pairCount)
  const rightSlice = right.slice(0, pairCount)
  const leftMean = mean(leftSlice)
  const rightMean = mean(rightSlice)

  let numerator = 0
  let leftVariance = 0
  let rightVariance = 0

  for (let index = 0; index < pairCount; index += 1) {
    const centeredLeft = leftSlice[index] - leftMean
    const centeredRight = rightSlice[index] - rightMean
    numerator += centeredLeft * centeredRight
    leftVariance += centeredLeft ** 2
    rightVariance += centeredRight ** 2
  }

  const denominator = Math.sqrt(leftVariance * rightVariance)
  return denominator === 0 ? 0 : numerator / denominator
}

export function formatDelta(delta: number, precision = 0) {
  const prefix = delta > 0 ? '+' : ''
  return `${prefix}${delta.toFixed(precision)}`
}

export function trendFromDelta(delta: number) {
  if (Math.abs(delta) < 0.5) {
    return 'stable'
  }

  return delta > 0 ? 'rising' : 'falling'
}

export function correlationLabel(correlation: number) {
  const magnitude = Math.abs(correlation)

  if (magnitude >= 0.8) {
    return correlation > 0 ? 'very strong positive' : 'very strong inverse'
  }

  if (magnitude >= 0.6) {
    return correlation > 0 ? 'strong positive' : 'strong inverse'
  }

  if (magnitude >= 0.35) {
    return correlation > 0 ? 'moderate positive' : 'moderate inverse'
  }

  if (magnitude >= 0.18) {
    return correlation > 0 ? 'weak positive' : 'weak inverse'
  }

  return 'little relationship'
}

export function describeCorrelation(
  correlation: number,
  leftLabel: string,
  rightLabel: string,
) {
  const label = correlationLabel(correlation)
  const direction = correlation >= 0 ? 'move together' : 'move in opposite directions'

  return `${leftLabel} and ${rightLabel} ${label} and tend to ${direction}.`
}

export function relativeColor(value: number) {
  if (value >= 0.65) {
    return 'positive'
  }

  if (value <= -0.35) {
    return 'negative'
  }

  return 'neutral'
}

export function computeMetricDeltas(
  records: OuraDay[],
  metricIds: MetricId[],
): MetricDelta[] {
  const latest = records[records.length - 1]
  const previous = records[records.length - 8] ?? records[records.length - 2]

  if (!latest || !previous) {
    return []
  }

  return metricIds.map((metricId) => {
    const current = latest[metricId]
    const prior = previous[metricId]
    const delta = current - prior
    const deltaPercent = prior === 0 ? null : (delta / prior) * 100

    return {
      metricId,
      current,
      previous: prior,
      delta,
      deltaPercent,
    }
  })
}

export function computePairwiseRelationships(
  records: OuraDay[],
  metricIds: MetricId[],
) {
  const pairs: RelationshipInsight[] = []

  for (let leftIndex = 0; leftIndex < metricIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < metricIds.length; rightIndex += 1) {
      const left = metricIds[leftIndex]
      const right = metricIds[rightIndex]
      const leftSeries = records.map((record) => record[left])
      const rightSeries = records.map((record) => record[right])
      const correlation = pearsonCorrelation(leftSeries, rightSeries)
      const leftLabel = getMetricDefinition(left).label
      const rightLabel = getMetricDefinition(right).label

      pairs.push({
        left,
        right,
        correlation,
        label: `${leftLabel} vs ${rightLabel}`,
        interpretation: describeCorrelation(correlation, leftLabel, rightLabel),
      })
    }
  }

  return pairs.sort((left, right) => Math.abs(right.correlation) - Math.abs(left.correlation))
}

export function buildChatContext(
  records: OuraDay[],
  metricIds: MetricId[],
  relationships: RelationshipInsight[],
  windowLabel: string,
): ChatContextSnapshot {
  const latest = records[records.length - 1]
  const selectedMetrics = latest
    ? metricIds.map((metricId) => ({
        metricId,
        label: getMetricDefinition(metricId).label,
        value: formatMetricValue(metricId, latest[metricId]),
      }))
    : []

  const headline =
    selectedMetrics.length === 0
      ? 'No metrics selected yet.'
      : `Focused on ${selectedMetrics.map((metric) => metric.label).join(', ')} over ${windowLabel}.`

  const notes = [
    'The chart values are normalized before overlay so unlike units can be compared directly.',
    'Correlation is Pearson over the active window, so use it as a directional hint, not a causal claim.',
    'The chat panel receives this snapshot automatically on every prompt.',
  ]

  return {
    windowLabel,
    selectedMetrics,
    keyRelationships: relationships.slice(0, 3),
    headline,
    notes,
  }
}


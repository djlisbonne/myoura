import { formatMetricValue, type MetricDefinition } from '../data/oura'
import type { ChartSeries } from './api'

export interface RelationshipInsight {
  left: string
  right: string
  correlation: number
  label: string
  interpretation: string
}

export interface ChatContextSnapshot {
  windowLabel: string
  selectedMetrics: Array<{
    metricId: string
    label: string
    latest: string
  }>
  keyRelationships: Array<{
    label: string
    interpretation: string
  }>
  headline: string
  sourceLabels: string[]
  notes: string[]
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

function pearsonCorrelation(left: number[], right: number[]) {
  const pairCount = Math.min(left.length, right.length)
  if (pairCount < 3) {
    return null
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
  return denominator === 0 ? null : numerator / denominator
}

function describeCorrelation(correlation: number, leftLabel: string, rightLabel: string) {
  const magnitude = Math.abs(correlation)
  const strength =
    magnitude >= 0.75 ? 'strong' : magnitude >= 0.45 ? 'moderate' : magnitude >= 0.2 ? 'weak' : 'little'
  const direction = correlation >= 0 ? 'move together' : 'move against each other'
  return `${leftLabel} and ${rightLabel} show ${strength} alignment and tend to ${direction}.`
}

export function computePairwiseRelationships(series: ChartSeries[], metricMap: Map<string, MetricDefinition>) {
  const pairs: RelationshipInsight[] = []

  for (let leftIndex = 0; leftIndex < series.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < series.length; rightIndex += 1) {
      const leftSeries = series[leftIndex]
      const rightSeries = series[rightIndex]
      const rightByX = new Map(
        rightSeries.points
          .filter((point) => typeof point.value === 'number' && Number.isFinite(point.value))
          .map((point) => [point.x, point.value as number] as const),
      )
      const leftValues: number[] = []
      const rightValues: number[] = []

      for (const point of leftSeries.points) {
        const rightValue = rightByX.get(point.x)
        if (typeof point.value === 'number' && typeof rightValue === 'number') {
          leftValues.push(point.value)
          rightValues.push(rightValue)
        }
      }

      const correlation = pearsonCorrelation(leftValues, rightValues)
      if (correlation === null) {
        continue
      }

      const leftLabel = metricMap.get(leftSeries.metricId)?.label ?? leftSeries.label
      const rightLabel = metricMap.get(rightSeries.metricId)?.label ?? rightSeries.label

      pairs.push({
        left: leftSeries.metricId,
        right: rightSeries.metricId,
        correlation,
        label: `${leftLabel} vs ${rightLabel}`,
        interpretation: describeCorrelation(correlation, leftLabel, rightLabel),
      })
    }
  }

  return pairs.sort((left, right) => Math.abs(right.correlation) - Math.abs(left.correlation))
}

export function buildChatContext(
  series: ChartSeries[],
  metricMap: Map<string, MetricDefinition>,
  relationships: RelationshipInsight[],
  windowLabel: string,
  sourceLabels: string[],
): ChatContextSnapshot {
  const selectedMetrics = series.flatMap((entry) => {
    const metric = metricMap.get(entry.metricId)
    const latestPoint = [...entry.points].reverse().find((point) => point.value !== null || point.textValue)
    if (!metric || !latestPoint) {
      return []
    }

    return [
      {
        metricId: entry.metricId,
        label: metric.label,
        latest: formatMetricValue(metric, latestPoint.value, latestPoint.textValue),
      },
    ]
  })

  const headline =
    selectedMetrics.length === 0
      ? 'No visible chart metrics are selected yet.'
      : `Focused on ${selectedMetrics.map((metric) => metric.label).join(', ')} over ${windowLabel}.`

  return {
    windowLabel,
    selectedMetrics,
    keyRelationships: relationships.slice(0, 3).map((entry) => ({
      label: entry.label,
      interpretation: entry.interpretation,
    })),
    headline,
    sourceLabels,
    notes: [
      'The visible chart metrics are injected automatically with each prompt.',
      'Relative mode is percent change from the first observed point in the active range.',
      'Normalized mode converts each series to percentile position so unlike units can share a chart.',
    ],
  }
}

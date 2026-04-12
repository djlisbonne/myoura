import type { MetricId, OuraDay } from '../data/oura'
import { clamp, mean, standardDeviation } from './analytics'

export type DisplayMode = 'raw' | 'normalized' | 'relative'
export type AxisSide = 'left' | 'right'
export type XAxisMode = 'date' | 'sequence'

export interface OverlayPoint {
  dateLabel: string
  sequenceLabel: string
  index: number
  raw: Record<MetricId, number>
  normalized: Record<MetricId, number>
  relative: Record<MetricId, number>
  [key: string]: string | number | Record<MetricId, number>
}

function rawKey(metricId: MetricId) {
  return `${metricId}__raw`
}

function normalizedKey(metricId: MetricId) {
  return `${metricId}__normalized`
}

function relativeKey(metricId: MetricId) {
  return `${metricId}__relative`
}

export function displayDataKey(metricId: MetricId, mode: DisplayMode) {
  if (mode === 'normalized') {
    return normalizedKey(metricId)
  }

  if (mode === 'relative') {
    return relativeKey(metricId)
  }

  return rawKey(metricId)
}

export function buildOverlayChartData(
  records: OuraDay[],
  selectedMetricIds: MetricId[],
): OverlayPoint[] {
  const selectedValues = selectedMetricIds.reduce<Record<MetricId, number[]>>(
    (accumulator, metricId) => {
      accumulator[metricId] = records.map((record) => record[metricId])
      return accumulator
    },
    {} as Record<MetricId, number[]>,
  )

  const normalizers = selectedMetricIds.reduce<Record<MetricId, { mean: number; spread: number }>>(
    (accumulator, metricId) => {
      const values = selectedValues[metricId]
      accumulator[metricId] = {
        mean: mean(values),
        spread: standardDeviation(values) || 1,
      }
      return accumulator
    },
    {} as Record<MetricId, { mean: number; spread: number }>,
  )

  const baselines = selectedMetricIds.reduce<Record<MetricId, number>>(
    (accumulator, metricId) => {
      accumulator[metricId] = records[0]?.[metricId] ?? 0
      return accumulator
    },
    {} as Record<MetricId, number>,
  )

  return records.map((record, index) => {
    const point: OverlayPoint = {
      dateLabel: new Date(`${record.date}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      sequenceLabel: `${index + 1}`,
      index,
      raw: {} as Record<MetricId, number>,
      normalized: {} as Record<MetricId, number>,
      relative: {} as Record<MetricId, number>,
    }

    selectedMetricIds.forEach((metricId) => {
      const value = record[metricId]
      const normalizer = normalizers[metricId]
      const baseline = baselines[metricId]
      const normalized = clamp(
        (value - normalizer.mean) / normalizer.spread,
        -3.5,
        3.5,
      )
      const relative = baseline === 0 ? 0 : ((value - baseline) / baseline) * 100

      point[rawKey(metricId)] = value
      point[normalizedKey(metricId)] = normalized
      point[relativeKey(metricId)] = relative
      point.raw[metricId] = value
      point.normalized[metricId] = normalized
      point.relative[metricId] = relative
    })

    return point
  })
}

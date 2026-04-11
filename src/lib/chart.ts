import type { MetricId, OuraDay } from '../data/oura'
import { clamp, mean, standardDeviation } from './analytics'

export interface OverlayPoint {
  dateLabel: string
  index: number
  raw: Record<MetricId, number>
  normalized: Record<MetricId, number>
  [metricId: string]: string | number | Record<MetricId, number>
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

  return records.map((record, index) => {
    const point: OverlayPoint = {
      dateLabel: new Date(`${record.date}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      index,
      raw: {} as Record<MetricId, number>,
      normalized: {} as Record<MetricId, number>,
    }

    selectedMetricIds.forEach((metricId) => {
      const normalizer = normalizers[metricId]
      const normalized = clamp(
        (record[metricId] - normalizer.mean) / normalizer.spread,
        -3.5,
        3.5,
      )

      point[metricId] = normalized
      point.raw[metricId] = record[metricId]
      point.normalized[metricId] = normalized
    })

    return point
  })
}


import type { ChartSeries } from './api'

export type DisplayMode = 'raw' | 'normalized' | 'relative'
export type AxisSide = 'left' | 'right'
export type XAxisMode = 'date' | 'sequence'

export interface OverlayPoint {
  x: string
  dateLabel: string
  sequenceLabel: string
  index: number
  raw: Record<string, number | null>
  normalized: Record<string, number | null>
  relative: Record<string, number | null>
  [key: string]: string | number | null | Record<string, number | null>
}

const rawKey = (metricId: string) => `${metricId}__raw`
const normalizedKey = (metricId: string) => `${metricId}__normalized`
const relativeKey = (metricId: string) => `${metricId}__relative`

export function displayDataKey(metricId: string, mode: DisplayMode) {
  if (mode === 'normalized') {
    return normalizedKey(metricId)
  }
  if (mode === 'relative') {
    return relativeKey(metricId)
  }
  return rawKey(metricId)
}

function labelForX(x: string, xType: 'day' | 'timestamp') {
  const date = xType === 'day' ? new Date(`${x}T00:00:00`) : new Date(x)
  if (Number.isNaN(date.getTime())) {
    return x
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function percentile(values: number[], value: number) {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((left, right) => left - right)
  const index = sorted.findIndex((entry) => entry >= value)
  if (index < 0) {
    return 1
  }
  return sorted.length === 1 ? 0.5 : index / (sorted.length - 1)
}

export function buildOverlayChartData(series: ChartSeries[]): OverlayPoint[] {
  const metricIds = series.map((entry) => entry.metricId)
  const seriesByMetric = new Map(series.map((entry) => [entry.metricId, entry] as const))
  const xValues = [...new Set(series.flatMap((entry) => entry.points.map((point) => point.x)))].sort()

  return xValues.map((x, index) => {
    const referenceSeries = series.find((entry) => entry.points.some((point) => point.x === x))
    const point: OverlayPoint = {
      x,
      dateLabel: labelForX(x, referenceSeries?.xType ?? 'day'),
      sequenceLabel: `${index + 1}`,
      index,
      raw: {},
      normalized: {},
      relative: {},
    }

    for (const metricId of metricIds) {
      const metricSeries = seriesByMetric.get(metricId)
      const seriesPoint = metricSeries?.points.find((entry) => entry.x === x)
      const rawValue = seriesPoint?.value ?? null
      const numericValues = metricSeries?.points
        .map((entry) => entry.value)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)) ?? []
      const baseline = numericValues[0] ?? null
      const normalized = typeof rawValue === 'number' ? percentile(numericValues, rawValue) : null
      const relative =
        typeof rawValue === 'number' && typeof baseline === 'number' && baseline !== 0
          ? ((rawValue - baseline) / baseline) * 100
          : typeof rawValue === 'number' && baseline === 0
            ? 0
            : null

      point.raw[metricId] = rawValue
      point.normalized[metricId] = normalized
      point.relative[metricId] = relative
      point[rawKey(metricId)] = rawValue
      point[normalizedKey(metricId)] = normalized
      point[relativeKey(metricId)] = relative
    }

    return point
  })
}
